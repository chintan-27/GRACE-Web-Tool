import os
from flask_cors import CORS
from flask_socketio import SocketIO
from predict import predict_single_file
from werkzeug.utils import secure_filename
from flask import Flask, request, jsonify, send_file



UPLOAD_FOLDER = "uploads"  # Directory for uploaded files
OUTPUT_FOLDER = "outputs"  # Directory for output files

os.makedirs(UPLOAD_FOLDER, exist_ok=True)  # Create upload folder if it doesn't exist
os.makedirs(OUTPUT_FOLDER, exist_ok=True)  # Create output folder if it doesn't exist

app = Flask(__name__)

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['OUTPUT_FOLDER'] = OUTPUT_FOLDER
app.config['SECRET_KEY'] = 'THIS_IS_SUPPOSED_TO_BE_SECRET!!!!'

CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*")

@socketio.on('connect')
def handle_connect():
    print("Client connected")

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
    
    return jsonify({"OK": "Done."}), 200

@socketio.on("test")
def test():
    progress = {"message" : "This is a test", "progress" : "100"}
    socketio.emit('progress_update', {'progress': progress["progress"], 'message': progress["message"]})

def send_progress_update(progress):
    """Send a JSON progress message to the frontend."""
    print(progress)
    socketio.emit('progress_update', {'progress': progress[1], 'message': progress[0]})


# @app.get("/events")
# def events():
#     # Run prediction
#     output_dir = app.config['OUTPUT_FOLDER']
#     return Response(
#         predict_single_file(
#             input_path=input_path,
#             output_dir=output_dir
#         ), 
#         mimetype="text/event-stream"
#     )

@app.get("/events")
def events():
    output_dir = app.config['OUTPUT_FOLDER']
    prediction_generator = predict_single_file(
        input_path=input_path,
        output_dir=output_dir
    )
    
    try:
        # Iterate through the generator to get progress updates
        for progress in prediction_generator:
            # Emit progress update
            send_progress_update(progress)
    except Exception as e:
        send_progress_update({'error': str(e)})
        print(e)
        return jsonify({"error": "An error occurred during prediction."}), 500


# def output():
#     output_dir = app.config['OUTPUT_FOLDER']
#     try:
#         # Prepare output file paths
#         nii_filename = os.path.basename(input_path).replace(".nii.gz", "_pred_"+model+".nii.gz")
#         nii_filepath = os.path.join(output_dir, nii_filename)
#         mat_filename = os.path.basename(input_path).replace(".nii.gz", "_pred_"+model+".mat")
#         mat_filepath = os.path.join(output_dir, mat_filename)

#         if os.path.exists(nii_filepath):
#             return send_file(nii_filepath, as_attachment=True)
#         elif os.path.exists(mat_filepath):
#             return send_file(mat_filepath, as_attachment=True)
#         else:
#             return jsonify({"error": "Prediction failed to generate output files."}), 500

#     except Exception as e:
#         return jsonify({"error": str(e)}), 500
    
@app.get("/goutput")
def graceOutput():
    output_dir = app.config['OUTPUT_FOLDER']
    try:
        # Prepare output file paths
        nii_filename = os.path.basename(input_path).replace(".nii.gz", "_pred_GRACE.nii.gz")
        nii_filepath = os.path.join(output_dir, nii_filename)
        mat_filename = os.path.basename(input_path).replace(".nii.gz", "_pred_GRACE.mat")
        mat_filepath = os.path.join(output_dir, mat_filename)

        if os.path.exists(nii_filepath):
            return send_file(nii_filepath, as_attachment=True)
        elif os.path.exists(mat_filepath):
            return send_file(mat_filepath, as_attachment=True)
        else:
            return jsonify({"error": "Prediction failed to generate output files."}), 500

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.get("/doutput")
def dominoOutput():
    output_dir = app.config['OUTPUT_FOLDER']
    try:
        # Prepare output file paths
        nii_filename = os.path.basename(input_path).replace(".nii.gz", "_pred_DOMINO.nii.gz")
        nii_filepath = os.path.join(output_dir, nii_filename)
        mat_filename = os.path.basename(input_path).replace(".nii.gz", "_pred_DOMINO.mat")
        mat_filepath = os.path.join(output_dir, mat_filename)

        if os.path.exists(nii_filepath):
            return send_file(nii_filepath, as_attachment=True)
        elif os.path.exists(mat_filepath):
            return send_file(mat_filepath, as_attachment=True)
        else:
            return jsonify({"error": "Prediction failed to generate output files."}), 500

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.get("/dppoutput")
def dominoppOutput():
    output_dir = app.config['OUTPUT_FOLDER']
    try:
        # Prepare output file paths
        nii_filename = os.path.basename(input_path).replace(".nii.gz", "_pred_DOMINOPP.nii.gz")
        nii_filepath = os.path.join(output_dir, nii_filename)
        mat_filename = os.path.basename(input_path).replace(".nii.gz", "_pred_DOMINOPP.mat")
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
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)
