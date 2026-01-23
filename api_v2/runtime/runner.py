import torch
import traceback
import sys

from pathlib import Path
import nibabel as nib

from monai.networks.nets import UNETR
from monai.inferers import sliding_window_inference

from runtime.preprocess import preprocess_image
from runtime.registry import get_model_config
from runtime.session import session_log, model_output_path
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
        self.crop_foreground = self.config.get("crop_foreground", False)
        self.num_classes = 12

        self.model = None

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
        session_log(self.session_id, f"[{self.model_name}] Load model")
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
            pos_embed="perceptron",
            norm_name="instance",
            res_block=True,
            dropout_rate=0.0,
        )

        state = torch.load(self.checkpoint, map_location="cpu", weights_only=True)
        state = {k.replace("module.", ""): v for k, v in state.items()}
        self.model.load_state_dict(state, strict=False)

        device = f"cuda:{self.gpu_id}"
        self.model = self.model.to(device).eval()

        self._emit("model_load_complete", 10)

    # -------------------------------------------------------
    def preprocess_input(self, input_path: Path):
        session_log(self.session_id, f"[{self.model_name}] Preprocessing input")
        self._emit("preprocess_start", 15)

        tensor, metadata = preprocess_image(
            image_path=input_path,
            session_id=self.session_id,
            spatial_size=self.spatial_size,
            normalization=self.norm,
            model_type=self.model_type,
            percentile_range=self.percentile_range,
            interpolation_mode=self.interpolation_mode,
            fixed_range=self.fixed_range,
            crop_foreground=self.crop_foreground,
        )

        # Tensor already has shape (1, 1, D, H, W) from preprocess_image
        tensor = tensor.to(f"cuda:{self.gpu_id}")

        self._emit("preprocess_complete", 25)
        return tensor, metadata

    # -------------------------------------------------------
    @torch.no_grad()
    def infer(self, tensor):
        session_log(self.session_id, f"[{self.model_name}] Inference start")
        self._emit("inference_start", 30)

        preds = sliding_window_inference(
            inputs=tensor,
            roi_size=self.spatial_size,
            sw_batch_size=4,
            predictor=self.model,
            overlap=0.8,
        )

        self._emit("inference_mid", 65)
        session_log(self.session_id, f"[{self.model_name}] Inference finished")

        return preds

    # -------------------------------------------------------
    def save_output(self, preds, metadata):
        self._emit("save_start", 70)

        preds_np = torch.argmax(preds, dim=1).cpu().numpy().squeeze()
        out_path = model_output_path(self.session_id, self.model_name)
        preds_np = preds_np.astype("uint8")

        # Save with original affine and header (matching v1 implementation)
        pred_img = nib.Nifti1Image(preds_np, affine=metadata["affine"], header=metadata["header"])
        nib.save(pred_img, str(out_path))

        session_log(self.session_id, f"[{self.model_name}] Saved to {out_path}")
        self._emit("model_complete", 100)

        return out_path

    # -------------------------------------------------------
    def run(self, input_path: Path):
        try:
            self.load_model()
            tensor, metadata = self.preprocess_input(input_path)
            preds = self.infer(tensor)
            return self.save_output(preds, metadata)

        except Exception as e:
            exc_type, exc_value, exc_tb = sys.exc_info()

            print("Exception type:", exc_type)
            print("Exception value:", exc_value)
        
            print("\nFormatted traceback:")
            traceback.print_tb(exc_tb)

            log_error(self.session_id, f"Model {self.model_name} crashed: {e}")
            self._emit("model_error", -1, detail=str(e))
            raise e
