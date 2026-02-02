import torch
import traceback
import sys
import numpy as np

from pathlib import Path
import nibabel as nib

from monai.networks.nets import UNETR
from monai.inferers import sliding_window_inference
from monai.transforms import ResizeWithPadOrCrop

from runtime.preprocess import preprocess_image
from runtime.registry import get_model_config
from runtime.session import session_log, model_output_path, session_input_native
from runtime.freesurfer import convert_to_native
from runtime.sse import push_event
from services.redis_client import set_progress
from services.logger import log_event, log_error


class ModelRunner:
    """
    Runs a single model end-to-end:
      - load UNETR
      - preprocess input
      - perform sliding window inference
      - save NIfTI output
      - log & SSE events
    """

    def __init__(self, model_name: str, session_id: str, gpu_id: int):
        self.model_name = model_name
        self.session_id = session_id
        self.gpu_id = gpu_id

        self.config = get_model_config(model_name)
        self.spatial_size = self.config["spatial_size"]
        self.norm = self.config["normalization"]
        self.checkpoint = Path(self.config["checkpoint"])
        self.model_type = self.config["type"]
        self.percentile_range = self.config.get("percentile_range", (20, 80))
        self.interpolation_mode = self.config.get("interpolation_mode", "bilinear")
        self.fixed_range = self.config.get("fixed_range", (0, 255))
        self.resize_spatial_size = self.config.get("resize_spatial_size", None)
        self.num_classes = 12
        self.proj_type = self.config['proj_type']

        self.model = None
        self.device = f"cuda:{self.gpu_id}"

    # -------------------------------------------------------
    def _emit(self, event: str, progress: int, detail=None):
        payload = {
            "event": event,
            "model": self.model_name,
            "progress": progress,
            "gpu": self.gpu_id,
        }
        if detail:
            payload["detail"] = detail

        push_event(self.session_id, payload)
        log_event(self.session_id, payload)
        set_progress(self.session_id, self.model_name, progress)

    # -------------------------------------------------------
    def load_model(self):
        session_log(self.session_id, f"[{self.model_name}] Loading model on GPU {self.gpu_id}")
        self._emit("model_load_start", 5)

        if not self.checkpoint.exists():
            msg = f"Checkpoint missing for {self.model_name}: {self.checkpoint}"
            log_error(self.session_id, msg)
            raise FileNotFoundError(msg)

        self.model = UNETR(
            in_channels=1,
            out_channels=self.num_classes,
            img_size=self.spatial_size,
            feature_size=16,
            hidden_size=768,
            mlp_dim=3072,
            num_heads=12,
            proj_type=self.proj_type,
            norm_name="instance",
            res_block=True,
            dropout_rate=0.0,
        )

        state = torch.load(self.checkpoint, map_location="cpu", weights_only=True)
        state = {k.replace("module.", ""): v for k, v in state.items()}
        self.model.load_state_dict(state, strict=False)

        self.model = self.model.to(self.device).eval()

        self._emit("model_load_complete", 10)

    # -------------------------------------------------------
    def preprocess_input(self, input_path: Path):
        session_log(self.session_id, f"[{self.model_name}] Preprocessing input")
        self._emit("preprocess_start", 15)

        # preprocess_image returns (tensor, input_img) where input_img is nibabel object
        image_tensor, input_img = preprocess_image(
            image_path=input_path,
            session_id=self.session_id,
            spatial_size=self.spatial_size,
            normalization=self.norm,
            model_type=self.model_type,
            percentile_range=self.percentile_range,
            interpolation_mode=self.interpolation_mode,
            fixed_range=self.fixed_range,
            resize_spatial_size=self.resize_spatial_size,
        )

        # Move tensor to GPU - shape is (1, 1, D, H, W)
        image_tensor = image_tensor.to(self.device)

        self._emit("preprocess_complete", 25)
        return image_tensor, input_img

    # -------------------------------------------------------
    @torch.no_grad()
    def infer(self, tensor):
        session_log(self.session_id, f"[{self.model_name}] Inference start on GPU {self.gpu_id}")
        self._emit("inference_start", 30)

        # Try with sw_batch_size=4 first, retry with 2 on OOM (matching v1 behavior)
        batch_sizes = [2, 1]
        preds = None

        for sw_batch_size in batch_sizes:
            try:
                session_log(self.session_id, f"[{self.model_name}] Trying sw_batch_size={sw_batch_size}")
                preds = sliding_window_inference(
                    inputs=tensor,
                    roi_size=self.spatial_size,
                    sw_batch_size=sw_batch_size,
                    predictor=self.model,
                    overlap=0.8,
                )
                break  # Success, exit retry loop
            except RuntimeError as e:
                if "out of memory" in str(e).lower() and sw_batch_size > batch_sizes[-1]:
                    session_log(self.session_id, f"[{self.model_name}] OOM with sw_batch_size={sw_batch_size}, retrying with smaller batch")
                    torch.cuda.empty_cache()
                    continue
                else:
                    raise  # Re-raise if not OOM or if we've exhausted retries

        if preds is None:
            raise RuntimeError(f"Inference failed for {self.model_name} even with smallest batch size")

        self._emit("inference_mid", 65)
        session_log(self.session_id, f"[{self.model_name}] Inference finished")

        return preds

    # -------------------------------------------------------
    def save_output(self, preds, input_img):
        """
        Save predictions using original image's affine and header (matching v1).
        Resizes predictions back to original input shape.
        For FreeSurfer models, also converts output back to native space orientation.
        """
        self._emit("save_start", 70)

        preds_np = torch.argmax(preds, dim=1).cpu().numpy().squeeze()

        # Resize prediction back to original input shape (matching v1)
        original_shape = input_img.shape
        session_log(self.session_id, f"[{self.model_name}] Resizing predictions from {preds_np.shape} to {original_shape}")

        resize_back = ResizeWithPadOrCrop(spatial_size=original_shape, mode="constant")
        preds_np = resize_back(preds_np[np.newaxis, ...])[0]

        out_path = model_output_path(self.session_id, self.model_name)
        preds_np = preds_np.astype("uint8")

        # Save with original affine and header (exactly like v1)
        pred_img = nib.Nifti1Image(preds_np, affine=input_img.affine, header=input_img.header)
        nib.save(pred_img, str(out_path))

        session_log(self.session_id, f"[{self.model_name}] Saved to {out_path}")

        # For FreeSurfer models, convert segmentation back to native space orientation
        if self.config.get("space") == "freesurfer":
            self._emit("native_conversion_start", 85)
            session_log(self.session_id, f"[{self.model_name}] Converting output to native space orientation")

            native_input = session_input_native(self.session_id)
            fs_output = out_path  # Current output in FS space
            native_output = out_path.parent / "output_native.nii.gz"

            ok = convert_to_native(fs_output, native_input, native_output, self.session_id)

            if ok:
                # Replace FS output with native output
                fs_output.rename(out_path.parent / "output_fs.nii.gz")  # Keep FS version
                native_output.rename(out_path)  # Make native version the default
                session_log(self.session_id, f"[{self.model_name}] Native space output saved as default")
            else:
                session_log(self.session_id, f"[{self.model_name}] WARNING: Native conversion failed, keeping FS-space output")

        self._emit("model_complete", 100)

        return out_path

    # -------------------------------------------------------
    def run(self, input_path: Path):
        try:
            self.load_model()
            tensor, input_img = self.preprocess_input(input_path)
            preds = self.infer(tensor)
            return self.save_output(preds, input_img)

        except Exception as e:
            exc_type, exc_value, exc_tb = sys.exc_info()

            print("Exception type:", exc_type)
            print("Exception value:", exc_value)

            print("\nFormatted traceback:")
            traceback.print_tb(exc_tb)

            log_error(self.session_id, f"Model {self.model_name} crashed: {e}")
            self._emit("model_error", -1, detail=str(e))
            raise e
