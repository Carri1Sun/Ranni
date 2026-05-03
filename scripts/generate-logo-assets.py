from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "logo.png"
PUBLIC = ROOT / "public"


def center_crop_square(image: Image.Image) -> Image.Image:
    width, height = image.size
    edge = min(width, height)
    left = (width - edge) // 2
    top = (height - edge) // 2
    return image.crop((left, top, left + edge, top + edge))


def rounded_resize(image: Image.Image, size: int, radius_ratio: float = 0.22) -> Image.Image:
    resized = image.resize((size, size), Image.Resampling.LANCZOS)
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    radius = round(size * radius_ratio)
    draw.rounded_rectangle((0, 0, size, size), radius=radius, fill=255)
    output = Image.new("RGBA", (size, size), (255, 255, 255, 0))
    output.paste(resized, (0, 0), mask)
    return output


def save_png(image: Image.Image, size: int, target: str) -> None:
    rounded_resize(image, size).save(PUBLIC / target, "PNG", optimize=True)


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"Missing logo source: {SOURCE}")

    PUBLIC.mkdir(parents=True, exist_ok=True)

    source = center_crop_square(Image.open(SOURCE).convert("RGBA"))
    save_png(source, 16, "favicon-16.png")
    save_png(source, 32, "favicon-32.png")
    save_png(source, 48, "favicon-48.png")
    save_png(source, 180, "apple-touch-icon.png")
    save_png(source, 192, "logo-192.png")
    save_png(source, 256, "logo.png")
    save_png(source, 512, "logo-512.png")

    favicon_sizes = [16, 32, 48, 64]
    favicon_images = [rounded_resize(source, size) for size in favicon_sizes]
    favicon_images[0].save(
        PUBLIC / "favicon.ico",
        format="ICO",
        sizes=[(size, size) for size in favicon_sizes],
        append_images=favicon_images[1:],
    )

    print("Generated logo assets in public/")


if __name__ == "__main__":
    main()
