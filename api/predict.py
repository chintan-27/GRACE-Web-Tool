import os
import torch
import nibabel as nib
import numpy as np
from monai.inferers import sliding_window_inference
from monai.networks.nets import UNETR
from monai.transforms import Compose, Spacingd, Orientationd, ScaleIntensityRanged, Resize
from monai.data import MetaTensor
from scipy.io import savemat

def load_model(model_path, spatial_size, num_classes, device, dataparallel=False, num_gpu=1):
    """
    Load and configure the model for inference.
    """
    print("Configuring model...")
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
    )

    if dataparallel:
        print("Using DataParallel with multiple GPUs")
        model = torch.nn.DataParallel(model, device_ids=list(range(num_gpu)))

    model = model.to(device)
    print(f"Loading model weights from {model_path}...")
    state_dict = torch.load(model_path, map_location=device, weights_only=True)
    state_dict = {k.replace("module.", ""): v for k, v in state_dict.items()}
    model.load_state_dict(state_dict, strict=False)
    model.eval()
    print("Model loaded successfully.")
    return model


def preprocess_input(input_path, device, a_min_value, a_max_value):
    """
    Load and preprocess the input NIfTI image.
    """
    print(f"Loading input image from {input_path}...")
    input_img = nib.load(input_path)
    image_data = input_img.get_fdata()
    print(f"Input image shape: {image_data.shape}")

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
            Orientationd(keys=["image"], axcodes="RAS"),
            ScaleIntensityRanged(keys=["image"], a_min=a_min_value, a_max=a_max_value, b_min=0.0, b_max=1.0, clip=True),
        ]
    )

    # Wrap the MetaTensor for the transform pipeline
    data = {"image": meta_tensor}
    transformed_data = test_transforms(data)

    # Convert to PyTorch tensor with .clone().detach()
    # image_tensor = torch.tensor(transformed_data["image"], dtype=torch.float32).clone().detach().unsqueeze(0).unsqueeze(0).to(device)
    image_tensor = transformed_data["image"].clone().detach().unsqueeze(0).unsqueeze(0).to(device)
    print(f"Model input shape: {image_tensor.shape}")
    return image_tensor, input_img

def save_predictions(predictions, input_img, output_dir, base_filename):
    """
    Save predictions as NIfTI and MAT files.
    """
    # Post-process predictions
    print("Post-processing predictions...")
    processed_preds = torch.argmax(predictions, dim=1).detach().cpu().numpy().squeeze()
    # Save as .nii.gz
    pred_img = nib.Nifti1Image(processed_preds, affine=input_img.affine, header=input_img.header)
    nii_save_path = os.path.join(output_dir, f"{base_filename}_pred.nii.gz")
    nib.save(pred_img, nii_save_path)
    print(f"Saved predictions as NIfTI file: {nii_save_path}")

    # Save as .mat
    mat_save_path = os.path.join(output_dir, f"{base_filename}_pred.mat")
    savemat(mat_save_path, {"testimage": processed_preds})
    print(f"Saved predictions as MAT file: {mat_save_path}")

def predict_single_file(input_path, output_dir="output", model_path="models/GRACE.pth",
                        spatial_size=(64, 64, 64), num_classes=12, dataparallel=False, num_gpu=1,
                        a_min_value=0, a_max_value=255):
    """
    Predict segmentation for a single NIfTI image and save the output as .nii.gz and .mat files.
    """
    os.makedirs(output_dir, exist_ok=True)
    base_filename = os.path.basename(input_path).split(".nii")[0]

    # Determine device
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if torch.backends.mps.is_available() and not torch.cuda.is_available():
        device = torch.device("cpu")  # Fall back to CPU for MPS due to ConvTranspose3d limitations
        print("Using MPS backend (CPU due to ConvTranspose3d support limitations)")

    print(f"Using device: {device}")

    # Load model
    model = load_model(model_path, spatial_size, num_classes, device, dataparallel, num_gpu)

    # Preprocess input
    image_tensor, input_img = preprocess_input(input_path, device, a_min_value, a_max_value)

    # Perform inference
    print("Performing sliding window inference...")
    with torch.no_grad():
        predictions = sliding_window_inference(
            image_tensor, spatial_size, sw_batch_size=4, predictor=model, overlap=0.8
        )
    print(f"Inference completed. Output shape: {predictions.shape}")

    # Save predictions
    save_predictions(predictions, input_img, output_dir, base_filename)

# Example usage
# if __name__ == "__main__":
#     input_path = "1.nii.gz"
#     output_dir = "outputs"
#     model_path = "models/GRACE.pth"

#     predict_single_file(
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
