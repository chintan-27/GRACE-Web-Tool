import os
import json
import torch
import numpy as np
import nibabel as nib
from asyncio import sleep
from scipy.io import savemat
from monai.data import MetaTensor
from monai.networks.nets import UNETR
from monai.inferers import sliding_window_inference
from monai.transforms import Compose, Spacingd, Orientationd, ScaleIntensityRanged, Resize

def send_progress(message, progress):
    """
        Helper function to send SSE progress updates
        @param message: Message about current stage of model prediction (str)
        @param progess: Progress percentage: (int)
        @return: JSON Data: {"message": message, "progress":progress}
    """
    return {"model": "domino", "message": message, "progress": progress}  

def load_model(model_path, spatial_size, num_classes, device):
    """
        Load and configure the model for inference.
        @param model_path: Path to the model weights file (str)
        @param spatial_size: Size of the input images (tuple)
        @param num_classes: Number of output classes (int)
        @param device: Device to run the model on (str or torch.device)
        @param dataparallel: Whether to use DataParallel (bool)
        @param num_gpu: Number of GPUs to use if dataparallel is True (int)
        @return: Configured model for inference (torch.nn.Module)
    """
    yield send_progress("Configuring model...", 10)

    # Domino Model source: https://github.com/lab-smile/DOMINO/blob/main/test_domino.py
    model = UNETR(
        in_channels=1,
        out_channels=num_classes,
        img_size=spatial_size,
        feature_size=16,
        hidden_size=768,
        mlp_dim=3072,
        num_heads=12,
        pos_embed="perceptron",
        norm_name="instance",
        res_block=True,
        dropout_rate=0.0,
    )

    # Data Parallel ? Wrap with torch.nn.DataParallel : Nothing
    # if dataparallel:
    #     yield send_progress("Initializing DataParallel with multiple GPUs", 15)
    #     model = torch.nn.DataParallel(model, device_ids=list(range(num_gpu)))

    # Device configured in the domino_predict_single_file function
    model = model.to(device)

    yield send_progress(f"Loading model weights from {model_path}...", 20)
    
    # Load weights
    state_dict = torch.load(model_path, map_location=device, weights_only=True)
    state_dict = {k.replace("module.", ""): v for k, v in state_dict.items()}
    
    model.load_state_dict(state_dict, strict=False)
    model = torch.nn.DataParallel(model, device_ids=[0,1])
    model.eval()
    
    yield send_progress("Model loaded successfully.", 25)
    return model



def preprocess_input(input_path, device, a_min_value=0, a_max_value=255, complexity_threshold=10000):
    """
    Load and preprocess the input NIfTI image to match training pipeline.
    Applies percentile-based normalization only for complex images.

    Args:
        input_path (str): Path to input .nii.gz file.
        device (torch.device): Torch device.
        a_min_value (float): Default min intensity for training-based normalization.
        a_max_value (float): Default max intensity for training-based normalization.
        complexity_threshold (float): If image max > threshold, apply percentile normalization.

    Returns:
        image_tensor (torch.Tensor), input_img (nib.Nifti1Image)
    """
    def normalize_fixed(data, a_min, a_max):
        data = np.clip(data, a_min, a_max)
        return (data - a_min) / (a_max - a_min + 1e-8)

    def normalize_percentile(data, lower=25, upper=75):
        pmin, pmax = np.percentile(data, [lower, upper])
        data = np.clip(data, pmin, pmax)
        return (data - pmin) / (pmax - pmin + 1e-8)

    yield send_progress(f"Loading input image from {input_path}...", 30)
    input_img = nib.load(input_path)
    image_data = input_img.get_fdata().astype(np.float32)

    yield send_progress(f"Image shape: {image_data.shape}, dtype: {image_data.dtype}", 32)
    image_max = np.max(image_data)
    image_min = np.min(image_data)
    image_mean = np.mean(image_data)
    yield send_progress(f"Image stats — Min: {image_min:.2f}, Max: {image_max:.2f}, Mean: {image_mean:.2f}", 34)

    # 🧠 Smart normalization logic
    if image_max > complexity_threshold:
        image_data = normalize_percentile(image_data)
        yield send_progress(f"Applied percentile normalization (due to max > {complexity_threshold})", 37)
#    elif image_max <= 255.0:
#        yield send_progress("Continued without normalization" , 37)
    else:
        image_data = normalize_fixed(image_data, a_min_value, a_max_value)
        yield send_progress(f"Applied fixed normalization: [{a_min_value}, {a_max_value}]", 37)

    # Wrap in MetaTensor (MONAI-friendly) and add channel
    meta_tensor = MetaTensor(image_data, affine=input_img.affine)

    # Apply MONAI spatial transforms
    test_transforms = Compose([
        Spacingd(keys=["image"], pixdim=(1.0, 1.0, 1.0), mode=("trilinear")),
        Orientationd(keys=["image"], axcodes="RA"),
#        CropForegroundd(keys=["image"], source_key="image"),
    ])

    yield send_progress("Applying spatial transforms...", 40)
    transformed = test_transforms({"image": meta_tensor})

    image_tensor = transformed["image"].unsqueeze(0).unsqueeze(0).to(device)  # shape: (1, 1, D, H, W)

    yield send_progress(f"Preprocessing complete. Final shape: {image_tensor.shape}", 45)
    return image_tensor, input_img



def save_predictions(predictions, input_img, output_dir, base_filename):
    """
        Save predictions as NIfTI and MAT files.
        @param predictions: Model output predictions (torch.Tensor)
        @param input_img: Original input image used for predictions (nibabel Nifti1Image)
        @param output_dir: Directory to save the output files (str)
        @param base_filename: Base filename for the saved output files (str)
    """
    
    yield send_progress("Post-processing predictions...", 80)
    processed_preds = torch.argmax(predictions, dim=1).detach().cpu().numpy().squeeze()
    
    # Save as .nii.gz
    yield send_progress("Saving NIfTI file...", 85)
    pred_img = nib.Nifti1Image(processed_preds, affine=input_img.affine, header=input_img.header)
    nii_save_path = os.path.join(output_dir, f"{base_filename}_pred_DOMINO.nii.gz")
    nib.save(pred_img, nii_save_path)
    
    # Save as .mat
    yield send_progress("Saving MAT file...", 90)
    mat_save_path = os.path.join(output_dir, f"{base_filename}_pred_DOMINO.mat")
    savemat(mat_save_path, {"testimage": processed_preds})
    yield send_progress("Files saved successfully.", 95)

def try_block(model_path, spatial_size, num_classes, device, input_path, a_min_value, a_max_value, sw_batch_size):
    # Load model
    model = yield from load_model(model_path, spatial_size, num_classes, device)

    # Preprocess input
    image_tensor, input_img = yield from preprocess_input(input_path, device, a_min_value, a_max_value)

    # Perform inference
    yield send_progress("Starting sliding window inference...", 50)
    
    with torch.no_grad():
        predictions = sliding_window_inference(
            image_tensor, spatial_size, sw_batch_size=sw_batch_size, predictor=model, overlap=0.8
        )
    
    yield send_progress("Inference completed successfully.", 75)

    return predictions, input_img

def domino_predict_single_file(input_path, output_dir="output", model_path="models/DOMINO.pth",
                       spatial_size=(256, 256, 256), num_classes=12,
                       a_min_value=0, a_max_value=255):
    """
        Predict segmentation for a single NIfTI image with progress updates via SSE.
        @param input_path: Path to the input NIfTI image file (str)
        @param output_dir: Directory to save the output files (str)
        @param model_path: Path to the model weights file (str)
        @param spatial_size: Size of the input images (tuple)
        @param num_classes: Number of output classes (int)
        @param dataparallel: Whether to use DataParallel (bool)
        @param num_gpu: Number of GPUs to use if dataparallel is True (int)
        @param a_min_value: Minimum intensity value for scaling (int or float)
        @param a_max_value: Maximum intensity value for scaling (int or float)
    """
    os.makedirs(output_dir, exist_ok=True)
    base_filename = os.path.basename(input_path).split(".nii")[0]

    # Determine device
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    sw_batch_size = 4
    if torch.backends.mps.is_available() and not torch.cuda.is_available():
        device = torch.device("cpu")
        yield send_progress("Using MPS backend (CPU due to ConvTranspose3d support limitations)", 5)
    else:
        yield send_progress(f"Using device: {device}", 5)

    try:
        predictions, input_img = yield from try_block(model_path, spatial_size, num_classes, device, input_path, a_min_value, a_max_value, sw_batch_size)
    except Exception as e:
        if isinstance(e, torch.cuda.OutOfMemoryError):
            yield send_progress("Error: Out of Memory during model inference.", 0)
            yield send_progress("Attempting retry with reduced resources", 0)
            if spatial_size[0] == 64:
                new_spatial_size = (32, 32, 32)
            elif spatial_size[0] == 256:
                new_spatial_size = (64, 64, 64)
            new_sw_batch_size = 2
            try:
                predictions, input_img = yield from try_block(model_path, new_spatial_size, num_classes, device, input_path, a_min_value, a_max_value, new_sw_batch_size)
                yield send_progress("Retry successful with reduced resources.", 75)
            except Exception as e:
                yield send_progress(f"Error during retry: {str(e)}", 0)
                return
        else:
            yield send_progress(f"Error during prediction: {str(e)}", 0)
            return
    # Save predictions
    yield from save_predictions(predictions, input_img, output_dir, base_filename)
    
    yield send_progress("Processing completed successfully!", 100)


# Example usage
# if __name__ == "__main__":
#     input_path = "1.nii.gz"
#     output_dir = "outputs"
#     model_path = "models/GRACE.pth"

#     domino_predict_single_file(
#         input_path=input_path,
#         output_dir=output_dir,
#         model_path=model_path,
#         spatial_size=(64, 64, 64),
#         num_classes=12,
#         dataparallel=False,
#         num_gpu=1,
#         a_min_value=0,
#         a_max_value=255,
#     )
