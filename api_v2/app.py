from fastapi import FastAPI

app = FastAPI(title="API v2 Backend", version="0.1")

@app.get("/")
def root():
    return {"status": "api_v2 running"}
