from monai.networks.nets import UNETR
from monai.losses import DiceCELoss
import torch
args = {}

args.N_classes = 12
args.spatial_size = 128

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print(f"Using device: {device}")

model = UNETR(
      in_channels=1,
      out_channels=args.N_classes, #12 for all tissues
      img_size=(args.spatial_size, args.spatial_size, args.spatial_size),
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

model.load_state_dict(torch.load("models/grace.pth"))
print("Model weights loaded from 'models/grace.pth'.")

dummy_input = torch.randn(1, 1, 128, 128, 128).to(device)
print("Dummy input created.")

torch.onnx.export(model, dummy_input, "models/grace.onnx", opset_version=11)
print("Model exported to 'models/grace.onnx'.")