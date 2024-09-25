from monai.networks.nets import UNETR
from monai.losses import DiceCELoss
from collections import defaultdict
import torch

args = defaultdict(lambda: None)
args['N_classes'] = 12
args['spatial_size'] = 64

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

dummy_input = torch.randn(1, 1, 64, 64, 64).to(device)
print("Dummy input created.")

onnx_model = torch.onnx.dynamo_export(model, dummy_input)
print("Model exported to onnx program.")

onnx_model.save("models/grace.onnx")
print("Model saved to 'models/grace.onnx'.")