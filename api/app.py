import torch
from flask_cors import CORS
from dotenv import load_dotenv
from werkzeug.utils import secure_filename
from flask_socketio import SocketIO, disconnect
from flask import Flask, request, jsonify, send_file

import hashlib, hmac, os, time
import jwt
from datetime import datetime, timedelta

# Import your model-specific files
from grace import grace_predict_single_file
from domino import domino_predict_single_file
from dominoplusplus import dominoplusplus_predict_single_file

UPLOAD_FOLDER = "uploads"
OUTPUT_FOLDER = "outputs"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(OUTPUT_FOLDER, exist_ok=True)
load_dotenv()
app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['OUTPUT_FOLDER'] = OUTPUT_FOLDER
app.config['SECRET_KEY'] = 'THIS_IS_SUPPOSED_TO_BE_SECRET!!!!'

API_SECRET = os.environ["API_SECRET"]
JWT_SECRET = os.environ["JWT_SECRET"]

ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
]

CORS(app,
    resources={r"/predict_(domino|grace|dominopp)": {"origins": ALLOWED_ORIGINS}, r"/(d|g|dpp)output": {"origins": ALLOWED_ORIGINS}},
    methods=["POST", "GET"],                      # Allow only what you need
    allow_headers=["Content-Type", "X-Signature"],
    supports_credentials=False,            # Flip to True only if you send cookies
    max_age=600,
)
socketio = SocketIO(app, cors_allowed_origins="*")

@socketio.on('connect')
def handle_connect():
    token = request.args.get('token')

    if not token:
        print("⛔ Missing authentication parameters")
        disconnect()
        return

    try:
        payload = jwt.decode(
            token,
            JWT_SECRET,
            algorithms=['HS256']
        )

        ts = payload.get('ts')
        signature = payload.get('signature')
        if ts is None or signature is None:
            return jsonify({"error": "invalid token"}), 400

        try:
            ts_ms = int(ts)
        except ValueError:
            return jsonify({"error": "invalid token"}), 400

        # Option A: direct millisecond diff
        now_ms = int(time.time() * 1000)
        if now_ms - ts_ms > 15 * 60 * 1000:
            disconnect()
            return jsonify({"error": "stale token"}), 401
        
        expected_sig = hmac.new(API_SECRET,
                            ts.encode('utf-8'),
                            hashlib.sha256
                           ).hexdigest()
        if not hmac.compare_digest(signature, expected_sig):
            return jsonify({"error": "invalid payload signature"}), 401

    except jwt.ExpiredSignatureError:
        disconnect()
        return jsonify({"error": "token expired"}), 401
    except jwt.InvalidTokenError:
        disconnect()
        return jsonify({"error": "invalid token"}), 401
    except Exception as e:
        print("⛔ Invalid timestamp format:", e)
        disconnect()
        return
    
    # expected_sig = hmac.new(API_SECRET.encode(), ts, hashlib.sha256).hexdigest()
    # if not hmac.compare_digest(expected_sig, signature):
    #     print("⛔ Invalid signature")
    #     disconnect()
    #     return
    print("Client connected")

@app.route("/", methods=["GET"])
def home():
    return "<h1>GRACE Web Interface API</h1><p>Send your input file to /predict_grace or /predict_domino</p>"

def save_uploaded_file(file):
    filename = secure_filename(file.filename)
    input_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(input_path)
    return input_path

def check_signature(token):
    if not token:
        return False
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
        ts = payload.get('ts')
        signature = payload.get('signature')
        if not ts or not signature:
            return False
        ts_int = int(ts)
        now_ms = int(time.time() * 1000)
        if abs(now_ms - ts_int) > 15 * 60 * 1000:
            print("Connection rejected: timestamp expired")
            return False
    except Exception as e:
        print("Invalid timestamp format:", e)
        return False
    expected_sig = hmac.new(API_SECRET.encode(), ts.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected_sig, signature):
        print("Invalid signature")
        return False
    return True

@app.route("/predict_grace", methods=["POST"])
def predict_grace():
    token = request.headers.get('X-Signature')

    if check_signature(token) is False:
        return jsonify({"error": "Invalid signature"}), 403

    file = request.files.get("file")

    if not file:
        return jsonify({"error": "No file uploaded"}), 400
    print("Received file for GRACE prediction:", file.filename)  # Verbose logging
    input_path = save_uploaded_file(file)
    print("File saved to:", input_path)  # Verbose logging
    base_filename = os.path.splitext(os.path.basename(input_path))[0]
    device = get_device()
    print("Using device for GRACE prediction:", device)  # Verbose logging
    for progress in grace_predict_single_file(input_path=input_path, output_dir=OUTPUT_FOLDER):
        print("GRACE progress update:", progress)  # Verbose logging
        socketio.emit("progress_grace", progress)
    return jsonify({"status": "GRACE completed"}), 200

@app.route("/predict_domino", methods=["POST"])
def predict_domino():
    token = request.headers.get('X-Signature')

    if check_signature(token) is False:
        return jsonify({"error": "Invalid signature"}), 403

    file = request.files.get("file")
    if not file:
        return jsonify({"error": "No file uploaded"}), 400
    print("Received file for DOMINO prediction:", file.filename)  # Verbose logging
    input_path = save_uploaded_file(file)
    print("File saved to:", input_path)  # Verbose logging
    base_filename = os.path.splitext(os.path.basename(input_path))[0]
    device = get_device()
    print("Using device for DOMINO prediction:", device)  # Verbose logging
    for progress in domino_predict_single_file(input_path=input_path, output_dir=OUTPUT_FOLDER):
        print("DOMINO progress update:", progress)  # Verbose logging
        socketio.emit("progress_domino", progress)
    return jsonify({"status": "DOMINO completed"}), 200

@app.route("/predict_dpp", methods=["POST"])
def predict_dpp():
    token = request.headers.get('X-Signature')

    if check_signature(token) is False:
        return jsonify({"error": "Invalid signature"}), 403

    file = request.files.get("file")
    if not file:
        return jsonify({"error": "No file uploaded"}), 400
    print("Received file for DOMINO++ prediction:", file.filename)  # Verbose logging
    input_path = save_uploaded_file(file)
    print("File saved to:", input_path)  # Verbose logging
    base_filename = os.path.splitext(os.path.basename(input_path))[0]
    device = get_device()
    print("Using device for DOMINO++ prediction:", device)  # Verbose logging
    for progress in dominoplusplus_predict_single_file(input_path=input_path, output_dir=OUTPUT_FOLDER):
        print("DOMINO++ progress update:", progress)  # Verbose logging
        socketio.emit("progress_dpp", progress)
    return jsonify({"status": "DOMINO++ completed"}), 200

@app.route("/goutput", methods=["GET"])
def grace_output():
    token = request.headers.get('X-Signature')
    if check_signature(token) is False:
        return jsonify({"error": "Invalid signature"}), 403
    return send_output_file("_pred_GRACE")

@app.route("/doutput", methods=["GET"])
def domino_output():
    token = request.headers.get('X-Signature')
    if check_signature(token) is False:
        return jsonify({"error": "Invalid signature"}), 403
    return send_output_file("_pred_DOMINO")

@app.route("/dppoutput", methods=["GET"])
def dominopp_output():
    token = request.headers.get('X-Signature')
    if check_signature(token) is False:
        return jsonify({"error": "Invalid signature"}), 403
    return send_output_file("_pred_DOMINOPP")

def send_output_file(suffix):
    try:
        for file in os.listdir(OUTPUT_FOLDER):
            if file.endswith(f"{suffix}.nii.gz"):
                return send_file(os.path.join(OUTPUT_FOLDER, file), as_attachment=True)
        return jsonify({"error": f"Output file for {suffix} not found"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500

def get_device():
    if torch.cuda.is_available():
        return torch.device("cuda")
    if torch.backends.mps.is_available():
        return torch.device("cpu")  # Replace with MPS if needed
    return torch.device("cpu")

if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)
