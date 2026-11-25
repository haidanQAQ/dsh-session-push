"""生成插件图标 512x512：深蓝渐变圆角底 + 白色铃铛 + 琥珀色未读圆点。"""
from PIL import Image, ImageDraw

SIZE = 512
SCALE = 4  # 先放大绘制再缩小，边缘更平滑
W = SIZE * SCALE


def gradient(size, top, bottom):
    img = Image.new("RGB", (size, size))
    draw = ImageDraw.Draw(img)
    for y in range(size):
        t = y / (size - 1)
        color = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        draw.line([(0, y), (size, y)], fill=color)
    return img


base = gradient(W, (18, 32, 66), (12, 74, 110))

# 圆角遮罩
mask = Image.new("L", (W, W), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, W - 1, W - 1], radius=int(W * 0.22), fill=255)

canvas = Image.new("RGBA", (W, W), (0, 0, 0, 0))
canvas.paste(base, (0, 0), mask)

draw = ImageDraw.Draw(canvas)
white = (255, 255, 255, 255)
cx = W // 2

# 铃身：圆顶 + 矩形裙摆
draw.pieslice([cx - 150 * SCALE, 120 * SCALE, cx + 150 * SCALE, 420 * SCALE], 180, 360, fill=white)
draw.rectangle([cx - 150 * SCALE, 270 * SCALE, cx + 150 * SCALE, 360 * SCALE], fill=white)
# 下沿微外张
draw.rounded_rectangle(
    [cx - 172 * SCALE, 352 * SCALE, cx + 172 * SCALE, 386 * SCALE],
    radius=17 * SCALE,
    fill=white,
)
# 顶部提手
draw.ellipse([cx - 26 * SCALE, 96 * SCALE, cx + 26 * SCALE, 148 * SCALE], fill=white)
# 底部铃舌
draw.ellipse([cx - 34 * SCALE, 396 * SCALE, cx + 34 * SCALE, 464 * SCALE], fill=white)
# 未读圆点
draw.ellipse([cx + 96 * SCALE, 96 * SCALE, cx + 196 * SCALE, 196 * SCALE], fill=(250, 197, 66, 255))

canvas.resize((SIZE, SIZE), Image.LANCZOS).save("icon.png")
print("icon.png written")
