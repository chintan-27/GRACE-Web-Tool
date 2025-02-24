import os
import json
import torch
import numpy as np
import nibabel as nib
from asyncio import sleep
from flask import Response
from scipy.io import savemat
from monai.data import MetaTensor
from monai.networks.nets import UNETR
from monai.inferers import sliding_window_inference
from monai.transforms import Compose, Spacingd, Orientationd, ScaleIntensityRanged, Resize

def send_progress(message, progress):
    """
    Helper function to send SSE progress updates.
    
    Args:
        message (str): Message about the current stage of model prediction.
        progress (int): Progress percentage.
    
    Returns:
        str: JSON Data formatted as "data: {data}\n\n".
    """
    data = json.dumps({"message": message, "progress": progress})
    return f"data: {data}\n\n"

def load_model(model_path, spatial_size, num_classes, device, dataparallel=False, num_gpu=1):
    """
    Load and configure the model for inference.
    
    Args:
        model_path (str): Path to the model weights file.
        spatial_size (tuple): Size of the input images.
        num_classes (int): Number of output classes.
        device (str or torch.device): Device to run the model on.
        dataparallel (bool): Whether to use DataParallel.
        num_gpu (int): Number of GPUs to use if dataparallel is True.
    
    Returns:
        torch.nn.Module: Configured model for inference.
    """

    model = UNETR(
        in_channels=1,
        out_channels=num_classes,
        img_size=spatial_size,
        feature_size=16,
        hidden_size=768,
        mlp_dim=3072,
        num_heads=12,
        norm_name="instance",
        res_block=True,
        dropout_rate=0.0,
        proj_type="perceptron",
    )

    # if dataparallel:
    #     yield send_progress("Initializing DataParallel with multiple GPUs", 15)
    #     model = torch.nn.DataParallel(model, device_ids=list(range(num_gpu)))

    model = model.to(device)
    
    state_dict = torch.load(model_path, map_location=device, weights_only=True)
    state_dict = {k.replace("module.", ""): v for k, v in state_dict.items()}
    model.load_state_dict(state_dict, strict=False)
    model.eval()
    
    return model

def preprocess_input(input_path, device, a_min_value, a_max_value):
    """
    Load and preprocess the input NIfTI image.
    
    Args:
        input_path (str): Path to the input NIfTI image file.
        device (str or torch.device): Device to run the preprocessing on.
        a_min_value (int or float): Minimum intensity value for scaling.
        a_max_value (int or float): Maximum intensity value for scaling.
    
    Returns:
        tuple: Preprocessed image tensor and the original input image.
    """
    input_img = nib.load(input_path)
    image_data = input_img.get_fdata()

    # Convert to MetaTensor for MONAI compatibility
    meta_tensor = MetaTensor(image_data, affine=input_img.affine)
    
    # Apply MONAI test transforms
    test_transforms = Compose(
        [
            Spacingd(
                keys=["image"],
                pixdim=(1.0, 1.0, 1.0),
                mode=("trilinear"),
            ),
            Orientationd(keys=["image"], axcodes="RA"),
            ScaleIntensityRanged(keys=["image"], a_min=a_min_value, a_max=a_max_value, b_min=0.0, b_max=1.0, clip=True),
        ]
    )

    data = {"image": meta_tensor}
    transformed_data = test_transforms(data)

    # Convert to PyTorch tensor
    image_tensor = transformed_data["image"].clone().detach().unsqueeze(0).unsqueeze(0).to(device)
    
    return image_tensor, input_img

def save_predictions(predictions, input_img, output_dir, base_filename, model_name):
    """
    Save predictions as NIfTI and MAT files.
    
    Args:
        predictions (torch.Tensor): Model output predictions.
        input_img (nibabel Nifti1Image): Original input image used for predictions.
        output_dir (str): Directory to save the output files.
        base_filename (str): Base filename for the saved output files.
        model_name (str): Name of the model used for saving the predictions.
    """
    processed_preds = torch.argmax(predictions, dim=1).detach().cpu().numpy().squeeze()
    
    # Save as .nii.gz
    pred_img = nib.Nifti1Image(processed_preds, affine=input_img.affine, header=input_img.header)
    nii_save_path = os.path.join(output_dir, f"{base_filename}_pred_{model_name}.nii.gz")
    nib.save(pred_img, nii_save_path)
    
    # Save as .mat
    mat_save_path = os.path.join(output_dir, f"{base_filename}_pred_{model_name}.mat")
    savemat(mat_save_path, {"testimage": processed_preds})

def grace_predict_single_file(device, input_path, output_dir, base_filename, model_path="models/GRACE.pth", 
                       spatial_size=(64, 64, 64), num_classes=12, dataparallel=False, num_gpu=1,
                       a_min_value=0, a_max_value=255):
    """
    Predict segmentation for a single NIfTI image with progress updates via SSE.
    
    Args:
        input_path (str): Path to the input NIfTI image file.
        output_dir (str): Directory to save the output files.
        model_name (str): Name of the model to use for prediction.
        spatial_size (tuple): Size of the input images.
        num_classes (int): Number of output classes.
        dataparallel (bool): Whether to use DataParallel.
        num_gpu (int): Number of GPUs to use if dataparallel is True.
        a_min_value (int or float): Minimum intensity value for scaling.
        a_max_value (int or float): Maximum intensity value for scaling.
    """
    yield send_progress("Configuring GRACE model... ", 10)
    
    # Load model
    model = load_model(model_path, spatial_size, num_classes, device, dataparallel, num_gpu)

    yield send_progress("Model loaded successfully.", 11)


    yield send_progress(f"Loading input image from {input_path}...", 12)
    # Preprocess input
    image_tensor, input_img = preprocess_input(input_path, device, a_min_value, a_max_value)

    yield send_progress(f"Preprocessing complete. Model input shape: {image_tensor.shape}", 15)

    # Perform inference
    yield send_progress("Starting sliding window inference...", 20)
    with torch.no_grad():
        predictions = sliding_window_inference(
            image_tensor, spatial_size, sw_batch_size=4, predictor=model, overlap=0.8
        )
    yield send_progress("Inference completed successfully.", 22)

    # Save predictions
    yield send_progress("Post-processing GRACE predictions...", 25)
    save_predictions(predictions, input_img, output_dir, base_filename, "GRACE")
    yield send_progress("GRACE Files saved successfully.", 29)
    
    yield send_progress("GRACE Model inferred!", 33)

def domino_predict_single_file(device, input_path, output_dir, base_filename, model_path="models/DOMINO.pth", 
                       spatial_size=(256, 256, 256), num_classes=12, dataparallel=False, num_gpu=1,
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
    yield send_progress("Configuring DOMINO model... ", 35)
    # Load model
    model = load_model(model_path, spatial_size, num_classes, device, dataparallel, num_gpu)

    yield send_progress("Model loaded successfully.", 36)

    yield send_progress(f"Loading input image from {input_path}...", 39)

    # Preprocess input
    image_tensor, input_img = preprocess_input(input_path, device, a_min_value, a_max_value)
    yield send_progress(f"Preprocessing complete. Model input shape: {image_tensor.shape}", 42)

    # Perform inference
    yield send_progress("Starting sliding window inference...", 45)
    with torch.no_grad():
        predictions = sliding_window_inference(
            image_tensor, spatial_size, sw_batch_size=4, predictor=model, overlap=0.8
        )
    yield send_progress("Inference completed successfully.", 55)

    yield send_progress("Post-processing predictions...", 60)
    # Save predictions
    save_predictions(predictions, input_img, output_dir, base_filename, "DOMINO")
    yield send_progress("DOMINO Files saved successfully.", 65)
    
    yield send_progress("DOMINO Model Inferred!", 67)

def dominoplusplus_predict_single_file(device, input_path, output_dir, base_filename, model_path="models/DOMINOPP.pth", 
                       spatial_size=(64, 64, 64), num_classes=12, dataparallel=False, num_gpu=1,
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
    yield send_progress("Configuring DOMINO++ model... ", 68)
    # Load model
    model = load_model(model_path, spatial_size, num_classes, device, dataparallel, num_gpu)
    yield send_progress("Model loaded successfully.", 70)

    yield send_progress(f"Loading input image from {input_path}...", 72)

    # Preprocess input
    image_tensor, input_img = preprocess_input(input_path, device, a_min_value, a_max_value)
    yield send_progress(f"Preprocessing complete. Model input shape: {image_tensor.shape}", 75)

    # Perform inference
    yield send_progress("Starting sliding window inference...", 80)
    with torch.no_grad():
        predictions = sliding_window_inference(
            image_tensor, spatial_size, sw_batch_size=4, predictor=model, overlap=0.8
        )
    yield send_progress("Inference completed successfully.", 85)

    yield send_progress("Post-processing predictions...", 90)
    # Save predictions
    save_predictions(predictions, input_img, output_dir, base_filename, "DOMINOPP")
    yield send_progress("DOMINO++ Files saved successfully.", 95)
    
    yield send_progress("Processing completed successfully!", 100)

def predict_single_file(input_path, output_dir="output"):
    os.makedirs(output_dir, exist_ok=True)
    base_filename = os.path.basename(input_path).split(".nii")[0]

    # Determine device
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if torch.backends.mps.is_available() and not torch.cuda.is_available():
        device = torch.device("cpu")
        yield send_progress("Using MPS backend (CPU due to ConvTranspose3d support limitations)", 5)
    else:
        yield send_progress(f"Using device: {device}", 5)

    yield from grace_predict_single_file(device, input_path, output_dir, base_filename, "models/GRACE.pth", (64, 64, 64), 12, False, 1, 0, 255)

    yield from domino_predict_single_file(device, input_path, output_dir, base_filename, "models/DOMINO.pth", (256, 256, 256), 12, False, 1, 0, 255)

    yield from dominoplusplus_predict_single_file(device, input_path, output_dir, base_filename, "models/DOMINOPP.pth", (64, 64, 64), 12, False, 1, 0, 255)