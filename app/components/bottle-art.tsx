import Image from "next/image";
import type { BottleImage } from "../lib/types";

type BottleArtProps = {
  image: BottleImage;
  alt: string;
  className?: string;
  priority?: boolean;
};

export function BottleArt({
  image,
  alt,
  className = "",
  priority = false,
}: BottleArtProps) {
  if (!image.src) {
    return (
      <div
        aria-label={alt}
        className={`bottle-art bottle-art--empty ${className}`}
        role="img"
      >
        <span>画像なし</span>
      </div>
    );
  }

  if (image.crop === "full") {
    return (
      <div className={`bottle-art bottle-art--uploaded ${className}`}>
        <Image
          alt={alt}
          fill
          priority={priority}
          sizes="(max-width: 640px) 38vw, 240px"
          src={image.src}
          unoptimized
        />
      </div>
    );
  }

  return (
    <div
      aria-label={alt}
      className={`bottle-art bottle-art--sprite bottle-art--${image.crop} ${className}`}
      role="img"
    />
  );
}
