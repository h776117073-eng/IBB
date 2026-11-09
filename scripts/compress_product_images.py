#!/usr/bin/env python3
"""Convert barcode-named product images to metadata-free 320px WebP files."""
from __future__ import annotations
import argparse, csv, re
from pathlib import Path
from PIL import Image, ImageOps, UnidentifiedImageError

EXTENSIONS={".jpg",".jpeg",".png",".webp",".bmp",".tif",".tiff"}

def normalize_barcode(value: str) -> str:
    digits=re.sub(r"\D","",value)
    return digits.zfill(13) if digits and len(digits)<=13 else digits

def convert(source: Path, target: Path, size: int, quality: int) -> tuple[str,int,int,str]:
    try:
        with Image.open(source) as original:
            image=ImageOps.exif_transpose(original).convert("RGB")
            image.thumbnail((size,size),Image.Resampling.LANCZOS)
            target.parent.mkdir(parents=True,exist_ok=True)
            image.save(target,"WEBP",quality=quality,method=6,optimize=True)
        return "CONVERTED",source.stat().st_size,target.stat().st_size,""
    except (OSError,UnidentifiedImageError,ValueError) as exc:
        return "FAILED",source.stat().st_size,0,str(exc)[:300]

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--input-dir",required=True)
    parser.add_argument("--output-dir",required=True)
    parser.add_argument("--manifest",required=True)
    parser.add_argument("--size",type=int,default=320)
    parser.add_argument("--quality",type=int,default=78)
    parser.add_argument("--max-files",type=int,default=0)
    args=parser.parse_args()
    source_dir=Path(args.input_dir); output_dir=Path(args.output_dir)
    files=[p for p in source_dir.rglob("*") if p.is_file() and p.suffix.lower() in EXTENSIONS]
    files.sort()
    if args.max_files: files=files[:args.max_files]
    rows=[]
    for source in files:
        code=normalize_barcode(source.stem)
        if not code:
            rows.append({"barcode":"","source":str(source),"target":"","status":"SKIPPED_INVALID_NAME","source_bytes":source.stat().st_size,"output_bytes":0,"error":"Filename does not contain a barcode"})
            continue
        target=output_dir/"products"/(code+".webp")
        if target.exists():
            rows.append({"barcode":code,"source":str(source),"target":str(target),"status":"SKIPPED_EXISTS","source_bytes":source.stat().st_size,"output_bytes":target.stat().st_size,"error":""})
            continue
        status,source_bytes,output_bytes,error=convert(source,target,args.size,args.quality)
        rows.append({"barcode":code,"source":str(source),"target":str(target),"status":status,"source_bytes":source_bytes,"output_bytes":output_bytes,"error":error})
    manifest=Path(args.manifest);manifest.parent.mkdir(parents=True,exist_ok=True)
    with manifest.open("w",encoding="utf-8-sig",newline="") as f:
        writer=csv.DictWriter(f,fieldnames=["barcode","source","target","status","source_bytes","output_bytes","error"])
        writer.writeheader();writer.writerows(rows)
    converted=[r for r in rows if r["status"]=="CONVERTED"]
    before=sum(r["source_bytes"] for r in converted);after=sum(r["output_bytes"] for r in converted)
    print({"scanned":len(rows),"converted":len(converted),"failed":sum(r["status"]=="FAILED" for r in rows),"source_bytes":before,"webp_bytes":after,"reduction_percent":round(100*(before-after)/before,2) if before else 0})

if __name__=="__main__":
    main()
