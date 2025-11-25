import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

SESSION_DIR = os.path.join(BASE_DIR, "sessions")
MODEL_DIR = os.path.join(BASE_DIR, "models")

REDIS_HOST = "localhost"
REDIS_PORT = 6379
REDIS_DB = 0

HMAC_SECRET = "change_me"
JWT_SECRET = "change_me"

GPU_COUNT = 4
