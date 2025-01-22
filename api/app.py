from asyncio import sleep
import os
from werkzeug.utils import secure_filename
from predict import predict_single_file
from flask import Flask, Response, request, jsonify, send_file
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

UPLOAD_FOLDER = "uploads"
OUTPUT_FOLDER = "outputs"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(OUTPUT_FOLDER, exist_ok=True)

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['OUTPUT_FOLDER'] = OUTPUT_FOLDER
spatial_size = "64,64,64"
num_classes = 12 
model_path = "models/GRACE.pth"
dataparallel = False
num_gpu = 1
input_path = ""

@app.get("/")
def home():
    return "<h1>GRACE Web Interface API</h1><p>send your input file to /predict </p>"

@app.route("/predict", methods=["POST"])
def predict():
    if "file" not in request.files:
        return jsonify({"error": "No file part"}), 400

    file = request.files["file"]
    if file.filename == "":
        return jsonify({"error": "No selected file"}), 400

    global input_path
    # Save uploaded file
    filename = secure_filename(file.filename)
    input_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(input_path)

    global spatial_size
    global num_classes
    global model_path
    global dataparallel
    global num_gpu

    # Get additional parameters
    spatial_size = request.form.get("spatial_size", "64,64,64")
    spatial_size = tuple(map(int, spatial_size.split(",")))
    num_classes = int(request.form.get("num_classes", 12))
    model_path = request.form.get("model_path", "models/GRACE.pth")
    dataparallel = request.form.get("dataparallel", False)
    num_gpu = int(request.form.get("num_gpu", 1))
    return jsonify({"OK": "Done."}), 200


@app.get("/events")
def events():
    # Run prediction
    output_dir = app.config['OUTPUT_FOLDER']
    return Response(
        predict_single_file(
            input_path=input_path,
            output_dir=output_dir,
            model_path=model_path,
            spatial_size=spatial_size,
            num_classes=num_classes,
            dataparallel=dataparallel,
            num_gpu=num_gpu
            ), 
        mimetype="text/event-stream")

@app.get("/output")
def output():
    output_dir = app.config['OUTPUT_FOLDER']
    try:
        # Prepare output file paths
        nii_filename = os.path.basename(input_path).replace(".nii.gz", "_pred.nii.gz")
        nii_filepath = os.path.join(output_dir, nii_filename)
        mat_filename = os.path.basename(input_path).replace(".nii.gz", "_pred.mat")
        mat_filepath = os.path.join(output_dir, mat_filename)

        if os.path.exists(nii_filepath):
            return send_file(nii_filepath, as_attachment=True)
        elif os.path.exists(mat_filepath):
            return send_file(mat_filepath, as_attachment=True)
        else:
            return jsonify({"error": "Prediction failed to generate output files."}), 500

    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
