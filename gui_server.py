# gui_server.py - servidor persistente de control de GUI (pyautogui).
# Lee acciones JSON por stdin (una por linea), responde JSON por linea.
import sys, json
import pyautogui
from PIL import ImageDraw, ImageFont
pyautogui.FAILSAFE = False
pyautogui.PAUSE = 0.05

print(json.dumps({"ready": True, "size": list(pyautogui.size())}), flush=True)

def grid(path, step=200):
    img = pyautogui.screenshot()
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 20)
    except Exception:
        font = ImageFont.load_default()
    w, h = img.size
    for x in range(0, w, step):
        d.line([(x, 0), (x, h)], fill=(255, 40, 40), width=1)
    for y in range(0, h, step):
        d.line([(0, y), (w, y)], fill=(255, 40, 40), width=1)
    for x in range(0, w, step):
        for y in range(0, h, step):
            d.text((x + 2, y + 1), f"{x},{y}", fill=(255, 40, 40), font=font)
    img.save(path)

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        a = json.loads(line)
        act = a.get("act")
        if act == "shot":
            pyautogui.screenshot(a["path"])
        elif act == "grid":
            grid(a["path"], int(a.get("step", 200)))
        elif act == "move":
            pyautogui.moveTo(a["x"], a["y"], duration=0.2)
        elif act == "click":
            pyautogui.click(a["x"], a["y"], clicks=int(a.get("clicks", 1)), button=a.get("button", "left"), duration=0.15)
        elif act == "type":
            pyautogui.write(a["text"], interval=0.02)
        elif act == "key":
            ks = [k.strip() for k in str(a["keys"]).split("+") if k.strip()]
            if len(ks) > 1:
                pyautogui.hotkey(*ks)
            elif ks:
                pyautogui.press(ks[0])
        elif act == "scroll":
            pyautogui.scroll(int(a["amount"]))
        elif act == "drag":
            pyautogui.moveTo(a["x1"], a["y1"], duration=0.15)
            pyautogui.dragTo(a["x2"], a["y2"], duration=0.4, button="left")
        else:
            print(json.dumps({"error": "unknown act"}), flush=True)
            continue
        print(json.dumps({"ok": True}), flush=True)
    except Exception as e:
        print(json.dumps({"error": str(e)}), flush=True)
