#!/usr/bin/env python3
"""
Enrich EchoTik exported creator data with gender/age/race predictions
from avatar images using DeepFace (or FairFace).

Usage:
    python enrich.py --input ../../apps/web/output/inspect/echotik-web-female-xxx.json
    python enrich.py --input creators.csv --output creators-enriched.csv
"""
import argparse
import csv
import json
import os
import sys
import urllib.request
from pathlib import Path

import pandas as pd

# DeepFace is imported lazily to avoid heavy import when just parsing args.


def download_avatar(url, cache_dir, influencer_id):
    """Download avatar image to cache_dir, return local path or None."""
    if not url or not url.startswith("http"):
        return None

    ext = ".jpg"
    if ".png" in url.lower():
        ext = ".png"
    elif ".jpeg" in url.lower():
        ext = ".jpeg"

    local_path = cache_dir / f"{influencer_id}{ext}"
    if local_path.exists():
        return str(local_path)

    try:
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            ),
            "Referer": "https://echotik.live/",
        }
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=15) as response:
            data = response.read()
            if len(data) < 100:
                return None
            local_path.write_bytes(data)
            return str(local_path)
    except Exception as e:
        print(f"[skip] avatar download failed for {influencer_id}: {e}")
        return None


def analyze_face(image_path):
    """Run DeepFace analysis on a single image."""
    from deepface import DeepFace

    result = DeepFace.analyze(
        img_path=image_path,
        actions=["gender", "age", "race"],
        enforce_detection=False,
        silent=True,
    )

    # DeepFace returns a list when multiple faces detected; take dominant face.
    if isinstance(result, list):
        result = result[0]

    gender = result.get("dominant_gender") or max(result.get("gender", {}), key=result.get("gender", {}).get, default="")
    age = result.get("age")
    race = result.get("dominant_race") or max(result.get("race", {}), key=result.get("race", {}).get, default="")

    gender_conf = result.get("gender", {}).get(gender) if isinstance(result.get("gender"), dict) else None
    race_conf = result.get("race", {}).get(race) if isinstance(result.get("race"), dict) else None

    return {
        "预测性别": str(gender).capitalize(),
        "预测年龄": int(age) if age is not None else "",
        "预测族裔": str(race).capitalize(),
        "性别可信度": round(gender_conf, 4) if gender_conf is not None else "",
        "族裔可信度": round(race_conf, 4) if race_conf is not None else "",
    }


def load_input(input_path):
    """Load JSON or CSV exported by the extension."""
    input_path = Path(input_path)
    if input_path.suffix.lower() == ".json":
        with open(input_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return pd.DataFrame(data)
    else:
        return pd.read_csv(input_path)


def main():
    parser = argparse.ArgumentParser(description="Enrich EchoTik creators with avatar demographics")
    parser.add_argument("--input", required=True, help="Input JSON or CSV from extension")
    parser.add_argument("--output", default=None, help="Output CSV path")
    parser.add_argument("--cache-dir", default="./avatar-cache", help="Directory to cache downloaded avatars")
    parser.add_argument("--limit", type=int, default=0, help="Only process first N creators (0 = all)")
    args = parser.parse_args()

    cache_dir = Path(args.cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)

    df = load_input(args.input)
    print(f"Loaded {len(df)} creators")

    if args.limit > 0:
        df = df.head(args.limit)
        print(f"Limited to first {args.limit} creators")

    enrichment_rows = []
    for idx, row in df.iterrows():
        influencer_id = row.get("influencer_id", idx)
        name = row.get("influencer_name", "")
        avatar_url = row.get("avatar_url", "")

        print(f"[{idx + 1}/{len(df)}] {name or influencer_id}")

        image_path = download_avatar(avatar_url, cache_dir, influencer_id)
        if not image_path:
            enrichment_rows.append({
                "预测性别": "",
                "预测年龄": "",
                "预测族裔": "",
                "性别可信度": "",
                "族裔可信度": "",
                "头像分析状态": "下载失败",
            })
            continue

        try:
            analysis = analyze_face(image_path)
            analysis["头像分析状态"] = "成功"
            enrichment_rows.append(analysis)
        except Exception as e:
            print(f"[skip] face analysis failed: {e}")
            enrichment_rows.append({
                "预测性别": "",
                "预测年龄": "",
                "预测族裔": "",
                "性别可信度": "",
                "族裔可信度": "",
                "头像分析状态": f"分析失败: {e}",
            })

    enriched_df = pd.concat([df.reset_index(drop=True), pd.DataFrame(enrichment_rows)], axis=1)

    if args.output:
        output_path = Path(args.output)
    else:
        stem = Path(args.input).stem
        output_path = Path(f"{stem}-enriched.csv")

    enriched_df.to_csv(output_path, index=False, encoding="utf-8-sig")
    print(f"\nSaved enriched data to: {output_path}")
    print(f"Total: {len(enriched_df)} rows")


if __name__ == "__main__":
    main()
