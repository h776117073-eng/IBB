import struct, gzip, json, os

def read_varint(buf, pos):
    val = 0; shift = 0
    while True:
        b = buf[pos]; pos += 1
        val |= (b & 0x7f) << shift
        if not (b & 0x80): return val, pos
        shift += 7

def write_varint(val):
    out = bytearray()
    while val >= 0x80:
        out.append((val & 0x7f) | 0x80)
        val >>= 7
    out.append(val)
    return bytes(out)

def deserialize_dir(raw):
    n, pos = read_varint(raw, 0)
    tile_ids = []
    last = 0
    for _ in range(n):
        d, pos = read_varint(raw, pos)
        last += d
        tile_ids.append(last)
    run_lengths = []
    for _ in range(n):
        v, pos = read_varint(raw, pos)
        run_lengths.append(v)
    lengths = []
    for _ in range(n):
        v, pos = read_varint(raw, pos)
        lengths.append(v)
    offsets = []
    for i in range(n):
        v, pos = read_varint(raw, pos)
        if v == 0 and i > 0:
            offsets.append(offsets[-1] + lengths[i-1])
        else:
            offsets.append(v - 1)
    return list(zip(tile_ids, run_lengths, lengths, offsets))

def serialize_dir(entries):
    out = bytearray()
    out.extend(write_varint(len(entries)))
    last = 0
    for tid, rl, l, off in entries:
        out.extend(write_varint(tid - last))
        last = tid
    for tid, rl, l, off in entries:
        out.extend(write_varint(rl))
    for tid, rl, l, off in entries:
        out.extend(write_varint(l))
    for i, (tid, rl, l, off) in enumerate(entries):
        if i > 0 and off == entries[i-1][3] + entries[i-1][2]:
            out.extend(write_varint(0))
        else:
            out.extend(write_varint(off + 1))
    return gzip.compress(bytes(out))

def get_zoom(tid):
    z = 0; acc = 0
    while True:
        cnt = 1 << (2 * z)
        if tid < acc + cnt: return z
        acc += cnt; z += 1

src_path = 'pmtiles/buildings.pmtiles'
with open(src_path, 'rb') as f:
    hdr = bytearray(f.read(127))
    root_off, root_len, meta_off, meta_len, leaf_off, leaf_len, tile_off, tile_len = struct.unpack('<8Q', hdr[8:72])
    f.seek(meta_off)
    meta_raw = f.read(meta_len)
    meta_json = json.loads(gzip.decompress(meta_raw).decode('utf-8'))

    f.seek(root_off)
    root_entries = deserialize_dir(gzip.decompress(f.read(root_len)))
    all_entries = []
    for tid, rl, l, off in root_entries:
        if rl == 0:
            f.seek(leaf_off + off)
            all_entries.extend(deserialize_dir(gzip.decompress(f.read(l))))
        else:
            all_entries.append((tid, rl, l, off))

    part1_entries = [e for e in all_entries if get_zoom(e[0]) <= 17]
    part2_entries = [e for e in all_entries if get_zoom(e[0]) == 18]

    def write_pmtiles(out_path, entries, min_z, max_z):
        entries = sorted(entries, key=lambda x: x[0])
        # Build deduplicated tile data buffer
        seen_src_offsets = {}
        tile_buf = bytearray()
        new_entries = []
        for tid, rl, l, old_off in entries:
            key = (old_off, l)
            if key in seen_src_offsets:
                new_off = seen_src_offsets[key]
            else:
                f.seek(tile_off + old_off)
                data = f.read(l)
                new_off = len(tile_buf)
                tile_buf.extend(data)
                seen_src_offsets[key] = new_off
            new_entries.append((tid, rl, l, new_off))

        # Split new_entries into leaf directories of 4096 entries each so root stays tiny (<16KB)
        CHUNK = 4096
        leaf_buf = bytearray()
        root_ents = []
        for i in range(0, len(new_entries), CHUNK):
            chunk = new_entries[i:i+CHUNK]
            leaf_gz = serialize_dir(chunk)
            l_off = len(leaf_buf)
            leaf_buf.extend(leaf_gz)
            root_ents.append((chunk[0][0], 0, len(leaf_gz), l_off))

        root_gz = serialize_dir(root_ents)
        assert len(root_gz) <= 16384, f"Root too large: {len(root_gz)}"

        m_copy = dict(meta_json)
        for vl in m_copy.get('vector_layers', []):
            vl['minzoom'] = min_z
            vl['maxzoom'] = max_z
        m_gz = gzip.compress(json.dumps(m_copy, ensure_ascii=False).encode('utf-8'))

        new_hdr = bytearray(hdr)
        r_off = 127
        r_len = len(root_gz)
        m_off = r_off + r_len
        m_len = len(m_gz)
        l_off_abs = m_off + m_len
        l_len_abs = len(leaf_buf)
        t_off_abs = l_off_abs + l_len_abs
        t_len_abs = len(tile_buf)

        struct.pack_into('<8Q', new_hdr, 8, r_off, r_len, m_off, m_len, l_off_abs, l_len_abs, t_off_abs, t_len_abs)
        struct.pack_into('<3Q', new_hdr, 72, len(new_entries), len(new_entries), len(seen_src_offsets))
        new_hdr[100] = min_z
        new_hdr[101] = max_z

        with open(out_path, 'wb') as out_f:
            out_f.write(new_hdr)
            out_f.write(root_gz)
            out_f.write(m_gz)
            out_f.write(leaf_buf)
            out_f.write(tile_buf)
        print(f"Wrote {out_path}: {os.path.getsize(out_path)/(1024*1024):.2f} MB ({len(new_entries)} tiles, Z{min_z}-Z{max_z})")

    write_pmtiles('pmtiles/buildings_z14_17.pmtiles', part1_entries, 14, 17)
    write_pmtiles('pmtiles/buildings_z18.pmtiles', part2_entries, 18, 18)
