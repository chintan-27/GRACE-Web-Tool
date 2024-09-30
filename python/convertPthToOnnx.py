# This scripts is tailored to MAC OS.
# You can modify it to run on Linux or Windows. Also use GPU instead of CPU.

from monai.networks.nets import UNETR
from monai.losses import DiceCELoss
from collections import defaultdict
import torch
import onnxruntime
import numpy as np

args = defaultdict(lambda: None)
args['N_classes'] = 12
args['spatial_size'] = 64
batch_size = 1
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print(f"Using device: {device}")

# Create the model without DataParallel for loading weights
model = UNETR(
    in_channels=1,
    out_channels=args['N_classes'],  # 12 for all tissues
    img_size=(args['spatial_size'], args['spatial_size'], args['spatial_size']),
    feature_size=16,
    hidden_size=768,
    mlp_dim=3072,
    num_heads=12,
    pos_embed="perceptron",
    norm_name="instance",
    res_block=True,
    dropout_rate=0.0,
).to(device)

print("Model initialized.")

loss_function = DiceCELoss(to_onehot_y=True, softmax=True)
torch.backends.cudnn.benchmark = True
optimizer = torch.optim.AdamW(model.parameters(), lr=1e-4, weight_decay=1e-5)
print("Optimizer created.")

# Load the state dict and remove the 'module.' prefix
state_dict = torch.load("models/grace.pth", map_location=device)
if 'module.' in next(iter(state_dict)):
    state_dict = {k.replace('module.', ''): v for k, v in state_dict.items()}
model.load_state_dict(state_dict)
print("Model weights loaded from 'models/grace.pth'.")

model.eval()  # Set the model to evaluation mode
print("Model set to evaluation mode.")

dummy_input = torch.randn(batch_size, 1, 64, 64, 64, requires_grad=True).to(device)
print("Dummy input created.")

# Replace the dynamo_export with regular export
torch.onnx.export(model, 
                  dummy_input, 
                  "models/grace.onnx",
                  export_params=True,
                  opset_version=18, # Change opset version to 16
                  do_constant_folding=True,
                  input_names=['input'],
                  output_names=['output'],
                  dynamic_axes={'input': {0: 'batch_size'},
                                'output': {0: 'batch_size'}})
print("Model exported to ONNX format and saved as 'models/grace.onnx'.")

# Remove the following lines as they're no longer needed
# onnx_model = torch.onnx.dynamo_export(model, dummy_input)
# print("Model exported to onnx program.")
# onnx_model.save("models/grace.onnx")
# print("Model saved to 'models/grace.onnx'.")

# After the verification step, add this test
try:
    ort_session = onnxruntime.InferenceSession("models/grace.onnx")
    ort_inputs = {ort_session.get_inputs()[0].name: dummy_input.detach().numpy()}
    ort_outputs = ort_session.run(None, ort_inputs)
    print("ONNX model test run successful.")
except Exception as e:
    print(f"Error during ONNX model test: {str(e)}")