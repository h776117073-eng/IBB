#!/usr/bin/env python3
"""Create non-inventory product suggestions for public Google Maps business pages."""
from __future__ import annotations
import argparse, hashlib, json
from datetime import datetime, timezone
from pathlib import Path

GROCERY=("grocery store","supermarket","market","convenience store","general store","gourmet grocery","greengrocer","produce market","fruit and vegetable")
BAKERY=("bakery","confectionery","candy store","sweets","ice cream")
CAFE=("coffee shop","cafe","internet cafe")
RESTAURANT=("restaurant","buffet","fast food","chicken restaurant","falafel","seafood","barbecue","diner","brunch","cafeteria")
BUTCHER=("butcher","chicken shop")
PRODUCE=("fruit and vegetable","greengrocer","produce market","vegetable wholesale")

def store_profile(place: dict) -> str:
    category=(str(place.get("source_category") or "")+" "+str(place.get("category") or "")).lower()
    if any(x in category for x in BUTCHER): return "butcher"
    if any(x in category for x in PRODUCE): return "produce"
    if any(x in category for x in BAKERY): return "bakery"
    if any(x in category for x in CAFE): return "cafe"
    if any(x in category for x in RESTAURANT): return "restaurant"
    if any(x in category for x in GROCERY): return "grocery"
    return ""

def product_matches(product: dict, profile: str) -> bool:
    category=str(product.get("category_ar") or "")
    source=str(product.get("category_source") or "").lower()
    if category=="غير مصنف" or product.get("quality_status")!="PUBLISHED": return False
    if profile=="grocery": return True
    if profile=="bakery":
        return any(x in category for x in ("مخبوزات","بسكويت","حلويات","شوكولاتة","ألبان","محليات","زيوت")) or any(x in source for x in ("bread","biscuit","cake","bakery","chocolate","sugar","flour"))
    if profile=="cafe":
        return any(x in category for x in ("مشروبات","قهوة","شاي","مياه","وجبات خفيفة","بسكويت")) or any(x in source for x in ("beverage","coffee","tea","water","snack"))
    if profile=="restaurant":
        return any(x in category for x in ("مشروبات","صلصات","توابل","شوربات","وجبات جاهزة","زيوت")) or any(x in source for x in ("beverage","sauce","spice","soup","meal","oil"))
    if profile=="butcher":
        return any(x in category for x in ("لحوم","دجاج","دواجن")) or any(x in source for x in ("meat","chicken","poultry"))
    if profile=="produce":
        return any(x in category for x in ("فواكه","خضروات","أغذية نباتية")) or any(x in source for x in ("fruit","vegetable","plant-based"))
    return False

def read_jsonl(path: str):
    with open(path,encoding="utf-8") as f:
        for line in f:
            if line.strip():
                yield json.loads(line)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--places",required=True)
    parser.add_argument("--products",required=True)
    parser.add_argument("--output",required=True)
    parser.add_argument("--per-place",type=int,default=20)
    args=parser.parse_args()
    products=[p for p in read_jsonl(args.products) if p.get("quality_status")=="PUBLISHED" and p.get("availability_status")=="REFERENCE_ONLY"]
    suggestions=[]; now=datetime.now(timezone.utc).isoformat(); counts={}
    for place in read_jsonl(args.places):
        if place.get("kind")!="BUSINESS" or place.get("visibility_status")!="PUBLISHED" or place.get("verification_status")!="VERIFIED_MATCH":
            continue
        profile=store_profile(place)
        if not profile: continue
        matches=[p for p in products if product_matches(p,profile) and p.get("image_key")]
        matches.sort(key=lambda p:(p.get("country_relevance")!="ARABIC_REGION",p.get("image_status")!="PENDING",p.get("barcode","")))
        selected=matches[:max(1,args.per_place)]
        counts[profile]=counts.get(profile,0)+1
        for product in selected:
            score=0.68
            if product.get("image_key"): score+=0.10
            if product.get("brand_source"): score+=0.04
            if product.get("country_relevance")=="ARABIC_REGION": score+=0.05
            if product.get("translation_status")=="REVIEWED": score+=0.08
            score=min(0.95,score)
            raw=str(place["id"])+"|"+str(product["barcode"])
            suggestions.append({
                "id":"dcs_"+hashlib.sha256(raw.encode()).hexdigest()[:28],
                "directory_place_id":place["id"],
                "barcode":product["barcode"],
                "match_score":round(score,3),
                "match_reason":"اختير المنتج لتوافق فئته مع نشاط المنشأة؛ هذا اقتراح من مكتبة مرجعية ولا يثبت توفره محليًا.",
                "status":"SUGGESTED",
                "created_at":now,
                "reviewed_at":None
            })
    out=Path(args.output);out.parent.mkdir(parents=True,exist_ok=True)
    with out.open("w",encoding="utf-8") as f:
        for row in suggestions:f.write(json.dumps(row,ensure_ascii=False)+"\n")
    print(json.dumps({"suggestions":len(suggestions),"places_by_profile":counts,"per_place_limit":args.per_place},ensure_ascii=False,indent=2))

if __name__=="__main__":
    main()
