import sys
import traceback
from pathlib import Path
from typing import Any

import numpy as np
import nibabel as nib
import torch
from monai.networks.nets import UNETR
from monai.inferers import sliding_window_inference
from monai.transforms import ResizeWithPadOrCrop

from crown_cli.core.config import CrownConfig
from crown_cli.core.hub import get_checkpoint
from crown_cli.core.progress import ProgressWriter
from crown_cli.inference.registry import get_model_config
from crown_cli.inference.preprocess import preprocess_image


class CLIModelRunner:
    """ModelRunner adapted for CLI: writes progress to progress.jsonl instead of Redis/SSE."""

    def __init__(self, model_name: str, job_dir: Path, gpu_id: int, cfg: CrownConfig,
                 input_space: str = "native"):
        self.model_name = model_name
        self.job_dir = job_dir
        self.gpu_id = gpu_id
        self.cfg = cfg
        self.input_space = input_space

        self.config = get_model_config(model_name)
        self.spatial_size = self.config["spatial_size"]
        self.norm = self.config["normalization"]
        self.model_type = self.config["type"]
        self.percentile_range = self.config.get("percentile_range", (20, 80))
        self.interpolation_mode = self.config.get("interpolation_mode", "bilinear")
        self.fixed_range = self.config.get("fixed_range", (0, 255))
        self.resize_spatial_size = self.config.get("resize_spatial_size")
        self.proj_type = self.config["proj_type"]
        self.num_classes = 12

        self.device = f"cuda:{self.gpu_id}" if torch.cuda.is_available() else "cpu"
        self.model = None
        self._writer = ProgressWriter(job_dir)

    def _emit(self, event: str, progress: int = 0, **kwargs: Any) -> None:
        self._writer.emit(event, model=self.model_name, progress=progress, gpu=self.gpu_id, **kwargs)

    def _log(self, msg: str) -> None:
        self._writer.emit("log", model=self.model_name, message=msg)

    def load_model(self) -> None:
        self._emit("model_load_start", progress=5)
        checkpoint = get_checkpoint(self.model_name, self.cfg)

        self.model = UNETR(
            in_channels=1, out_channels=self.num_classes,
            img_size=self.spatial_size, feature_size=16,
            hidden_size=768, mlp_dim=3072, num_heads=12,
            proj_type=self.proj_type, norm_name="instance",
            res_block=True, dropout_rate=0.0,
        )
        state = torch.load(checkpoint, map_location="cpu", weights_only=True)
        state = {k.replace("module.", ""): v for k, v in state.items()}
        self.model.load_state_dict(state, strict=False)
        self.model = self.model.to(self.device).eval()
        self._emit("model_load_complete", progress=10)

    def preprocess_input(self, input_path: Path):
        self._emit("preprocess_start", progress=15)
        is_fs_model = self.config.get("space") == "freesurfer"
        image_tensor, input_img = preprocess_image(
            image_path=input_path,
            log_fn=self._log,
            spatial_size=self.spatial_size,
            normalization=self.norm,
            model_type=self.model_type,
            percentile_range=self.percentile_range,
            interpolation_mode=self.interpolation_mode,
            fixed_range=self.fixed_range,
            resize_spatial_size=self.resize_spatial_size,
            skip_spatial_transforms=is_fs_model,
        )
        image_tensor = image_tensor.to(self.device)
        self._emit("preprocess_complete", progress=25)
        return image_tensor, input_img

    @torch.no_grad()
    def infer(self, tensor):
        self._emit("inference_start", progress=30)
        preds = None
        for sw_batch_size in [2, 1]:
            try:
                preds = sliding_window_inference(
                    inputs=tensor, roi_size=self.spatial_size,
                    sw_batch_size=sw_batch_size, predictor=self.model, overlap=0.8,
                )
                break
            except RuntimeError as e:
                if "out of memory" in str(e).lower() and sw_batch_size > 1:
                    torch.cuda.empty_cache()
                    continue
                raise
        if preds is None:
            raise RuntimeError(f"Inference failed for {self.model_name}")
        self._emit("inference_mid", progress=65)
        return preds

    def save_output(self, preds, input_img, out_dir: Path) -> Path:
        self._emit("save_start", progress=70)
        preds_np = torch.argmax(preds, dim=1).cpu().numpy().squeeze()
        is_fs_model = self.config.get("space") == "freesurfer"

        if not is_fs_model:
            resize_back = ResizeWithPadOrCrop(spatial_size=input_img.shape, mode="constant")
            preds_np = resize_back(preds_np[np.newaxis, ...])[0]

        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / self.model_name / "output.nii.gz"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        preds_np = preds_np.astype("uint8")
        pred_img = nib.Nifti1Image(preds_np, affine=input_img.affine, header=input_img.header)
        nib.save(pred_img, str(out_path))

        if is_fs_model and self.input_space != "freesurfer":
            self._convert_to_native(out_path, input_img)

        self._emit("model_complete", progress=100)
        return out_path

    def _convert_to_native(self, out_path: Path, input_img) -> None:
        from crown_cli.inference.freesurfer import convert_to_native
        cfg = self.cfg
        mri_vol2vol = cfg.freesurfer_home / "bin" / "mri_vol2vol"
        native_output = out_path.parent / "output_native.nii.gz"
        # native_input is the original uploaded file — stored as input.nii.gz in job dir
        native_input = self.job_dir / "input.nii.gz"
        ok = convert_to_native(out_path, native_input, native_output, mri_vol2vol, self._log)
        if ok:
            out_path.rename(out_path.parent / "output_fs.nii.gz")
            native_output.rename(out_path)

    def run(self, input_path: Path, out_dir: Path) -> Path:
        try:
            self.load_model()
            tensor, input_img = self.preprocess_input(input_path)
            preds = self.infer(tensor)
            return self.save_output(preds, input_img, out_dir)
        except Exception as e:
            self._emit("model_error", progress=-1, detail=str(e))
            raise
