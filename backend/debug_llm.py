import httpx
import json

try:
    resp = httpx.get("http://localhost:1234/api/v0/models", timeout=5.0)
    with open("output.json", "w") as f:
        json.dump(resp.json(), f, indent=2)
    print("Success")
except Exception as e:
    with open("error.txt", "w") as f:
        f.write(str(e))
    print(f"Error: {e}")
