import sys
import subprocess

# Auto-install Pillow if needed
try:
    from PIL import Image, ImageDraw
except ImportError:
    print("Pillow not found. Installing Pillow...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "Pillow"])
    from PIL import Image, ImageDraw

def generate_icons():
    # We build a high-resolution 512x512 canvas first, then downsample for premium quality
    base_size = 512
    img = Image.new("RGBA", (base_size, base_size), (0, 0, 0, 0))
    
    # 1. Create a diagonal gradient background
    # Indigo (#6366f1) -> Purple (#a855f7)
    # Start: RGB (99, 102, 241)
    # End: RGB (168, 85, 247)
    gradient = Image.new("RGBA", (base_size, base_size))
    grad_pixels = gradient.load()
    for y in range(base_size):
        for x in range(base_size):
            t = (x + y) / (2.0 * base_size)
            r = int(99 + (168 - 99) * t)
            g = int(102 + (85 - 102) * t)
            b = int(241 + (247 - 241) * t)
            grad_pixels[x, y] = (r, g, b, 255)

    # 2. Mask it into a rounded rectangle
    mask = Image.new("L", (base_size, base_size), 0)
    mask_draw = ImageDraw.Draw(mask)
    # Coordinates: padding of 16px, radius of 110px
    mask_draw.rounded_rectangle([16, 16, 496, 496], radius=110, fill=255)
    
    # Paste the gradient onto the main transparent image using the rounded mask
    img.paste(gradient, (0, 0), mask)
    
    # 3. Draw white vector shapes
    draw = ImageDraw.Draw(img)
    
    # Outer glow / circular ring fragment (centered at 256, 256)
    # bounding box for the arc
    arc_box = [136, 136, 376, 376]
    draw.arc(arc_box, start=135, end=405, fill=(255, 255, 255, 90), width=24)
    
    # Play triangle vertices
    # Centered at (236, 266) to balance visually with the base
    # Coordinates:
    # Left vertical edge from y=200 to y=320, x=220
    # Right vertex pointing right at x=316, y=260
    draw.polygon([(220, 196), (220, 316), (324, 256)], fill=(255, 255, 255, 255))
    
    # Downward arrow shaft
    # x=256, y from 96 to 176
    draw.line([(256, 96), (256, 160)], fill=(255, 255, 255, 255), width=24)
    
    # Horizontal line at the bottom
    # x from 160 to 352, y=390
    draw.line([(160, 390), (352, 390)], fill=(255, 255, 255, 255), width=24)
    
    # 4. Generate the target sizes and save
    sizes = [16, 48, 128]
    for size in sizes:
        # Resize with high-quality antialiasing
        resized_img = img.resize((size, size), Image.Resampling.LANCZOS)
        filename = f"icon{size}.png"
        resized_img.save(filename, "PNG")
        print(f"Generated {filename}")

if __name__ == "__main__":
    generate_icons()
