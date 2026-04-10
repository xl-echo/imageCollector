from PIL import Image

# 用原始财神爷图片
src = r'C:\Users\ZTSK\Downloads\财神爷捧大金元.png'
img = Image.open(src)
print(f'Source: {img.size}')

# 生成多尺寸 ICO (Pillow 自动生成标准 Windows BMP+PNG 混合格式)
sizes = [(256, 256), (48, 48), (32, 32), (16, 16)]
img.save(
    r'D:\AI\product\ImageCollector\v1.0.0\icon.ico',
    format='ICO',
    sizes=sizes
)

# 同时保存 PNG
img256 = img.resize((256, 256), Image.LANCZOS)
img256.save(r'D:\AI\product\ImageCollector\v1.0.0\icon.png')

print('Done! icon.ico and icon.png regenerated with Pillow')

# 验证
from PIL import IcoImagePlugin
ico = IcoImagePlugin.IcoImageFile(r'D:\AI\product\ImageCollector\v1.0.0\icon.ico')
print(f'ICO sizes: {ico.info.get("sizes", "N/A")}')
