"""
Complex verification workload for EcoTrace / Kiro Code Profiler.

This script is intentionally inefficient and broad:
- CPU heavy: repeated prime checks, recursive Fibonacci, compression, sorting
- RAM heavy: large in-memory records, duplicated transforms, JSON materialization
- Disk heavy: writes and re-reads NDJSON and binary blobs
- Network heavy: local HTTP server with repeated JSON round-trips

Use it to verify:
- time-series charts populate for more than a few samples
- monitoring shows live RAM/CPU updates
- session history and baseline comparisons behave correctly
- LLM suggestions have enough anti-patterns to work with
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import http.server
import json
import math
import random
import socketserver
import tempfile
import threading
import time
import urllib.request
from pathlib import Path


SEED = 20260424


class ThreadedTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True


class DemoHandler(http.server.BaseHTTPRequestHandler):
    dataset = [{"id": i, "value": (i * 97) % 101, "label": f"row-{i}"} for i in range(400)]

    def do_GET(self) -> None:
        payload = json.dumps(
            {
                "path": self.path,
                "rows": self.dataset,
                "timestamp": time.time(),
            }
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length)
        body = json.loads(raw.decode("utf-8")) if raw else {}
        response = json.dumps(
            {
                "received": len(raw),
                "echoCount": len(body.get("values", [])),
                "checksum": hashlib.sha256(raw).hexdigest(),
            }
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)

    def log_message(self, format: str, *args: object) -> None:
        return


def fib(n: int) -> int:
    if n <= 1:
        return n
    return fib(n - 1) + fib(n - 2)


def is_prime(n: int) -> bool:
    if n < 2:
        return False
    for i in range(2, n):
        if n % i == 0:
            return False
    return True


def generate_records(size: int) -> list[dict[str, object]]:
    records = []
    for i in range(size):
        payload = [random.randint(0, 10_000) for _ in range(24)]
        transformed = [math.sqrt(value * value + (i % 17)) for value in payload]
        records.append(
            {
                "id": i,
                "payload": payload,
                "transformed": transformed,
                "category": f"group-{i % 11}",
                "text": ",".join(str(value) for value in payload),
            })
    return records


def cpu_pipeline(iterations: int) -> dict[str, object]:
    limit = 5500 + iterations * 250
    primes = [n for n in range(2, limit) if is_prime(n)]
    fib_value = fib(32 + min(iterations, 4))
    sorted_payload = sorted(
        (
            sum((value * value) % 97 for value in range(500 + idx % 30))
            for idx in range(1400 + iterations * 120)
        ),
        reverse=True,
    )
    return {
        "primeCount": len(primes),
        "largestPrime": primes[-1] if primes else None,
        "fib": fib_value,
        "topValues": sorted_payload[:10],
    }


def disk_pipeline(workdir: Path, records: list[dict[str, object]], passes: int) -> dict[str, object]:
    json_path = workdir / "records.ndjson"
    blob_path = workdir / "payload.bin.gz"

    for _ in range(passes):
        with json_path.open("w", encoding="utf-8") as handle:
            for record in records:
                handle.write(json.dumps(record) + "\n")

    aggregate = 0
    with json_path.open("r", encoding="utf-8") as handle:
        for line in handle:
            obj = json.loads(line)
            aggregate += int(obj["id"])

    with gzip.open(blob_path, "wb") as handle:
        for record in records[: min(len(records), 2500)]:
            payload = json.dumps(record).encode("utf-8")
            handle.write(payload)

    compressed_size = blob_path.stat().st_size
    return {
        "path": str(json_path),
        "aggregate": aggregate,
        "compressedSize": compressed_size,
    }


def network_pipeline(base_url: str, rounds: int) -> dict[str, object]:
    total_bytes = 0
    checksums: list[str] = []

    for round_idx in range(rounds):
        with urllib.request.urlopen(f"{base_url}/data?round={round_idx}") as response:
            raw = response.read()
            total_bytes += len(raw)
            payload = json.loads(raw.decode("utf-8"))

        outbound = json.dumps(
            {
                "round": round_idx,
                "values": payload["rows"][:100],
                "digest": hashlib.md5(raw).hexdigest(),
            }
        ).encode("utf-8")
        request = urllib.request.Request(
            f"{base_url}/submit",
            data=outbound,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request) as response:
            result = json.loads(response.read().decode("utf-8"))
            total_bytes += result["received"]
            checksums.append(result["checksum"])

    return {
        "rounds": rounds,
        "bytes": total_bytes,
        "checksumTail": checksums[-3:],
    }


def simulated_network_pipeline(rounds: int) -> dict[str, object]:
    total_bytes = 0
    digests: list[str] = []
    payload = [{"id": i, "name": f"fallback-{i}", "value": (i * 13) % 17} for i in range(800)]

    for round_idx in range(rounds):
        raw = json.dumps({"round": round_idx, "rows": payload}, sort_keys=True).encode("utf-8")
        total_bytes += len(raw)
        compressed = gzip.compress(raw)
        total_bytes += len(compressed)
        digests.append(hashlib.sha256(compressed).hexdigest())

    return {
        "rounds": rounds,
        "bytes": total_bytes,
        "checksumTail": digests[-3:],
        "mode": "simulated",
    }


def memory_pipeline(records: list[dict[str, object]], passes: int) -> dict[str, object]:
    expanded: list[dict[str, object]] = []
    for pass_idx in range(passes):
        for record in records:
            expanded.append(
                {
                    "id": record["id"],
                    "pass": pass_idx,
                    "text": str(record["text"]) * 2,
                    "payload": list(record["payload"]),
                    "transformed": list(record["transformed"]),
                }
            )
    score = sum(len(item["text"]) + len(item["payload"]) for item in expanded[:5000])
    return {"expandedRows": len(expanded), "score": score}


def run_demo(iterations: int, record_count: int, network_rounds: int) -> None:
    random.seed(SEED)
    start = time.time()

    print("Starting complex profiler demo...")
    print(f"iterations={iterations} record_count={record_count} network_rounds={network_rounds}")

    server: ThreadedTCPServer | None = None
    base_url: str | None = None
    try:
        server = ThreadedTCPServer(("127.0.0.1", 0), DemoHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base_url = f"http://127.0.0.1:{server.server_address[1]}"
        print(f"loopback_server={base_url}")
    except OSError as exc:
        print(f"loopback_server=unavailable ({exc}); falling back to simulated network workload")

    temp_root = Path(tempfile.mkdtemp(prefix="eco-demo-"))
    print(f"working_dir={temp_root}")

    try:
        t0 = time.time()
        records = generate_records(record_count)
        print(f"[1/4] generated {len(records)} records in {time.time() - t0:.2f}s")

        t0 = time.time()
        cpu_result = cpu_pipeline(iterations)
        print(f"[2/4] cpu pipeline finished in {time.time() - t0:.2f}s: {cpu_result}")

        t0 = time.time()
        disk_result = disk_pipeline(temp_root, records, max(2, iterations))
        print(f"[3/4] disk pipeline finished in {time.time() - t0:.2f}s: {disk_result}")

        t0 = time.time()
        network_result = (
            network_pipeline(base_url, network_rounds)
            if base_url is not None
            else simulated_network_pipeline(network_rounds)
        )
        print(f"[4/4] network pipeline finished in {time.time() - t0:.2f}s: {network_result}")

        t0 = time.time()
        memory_result = memory_pipeline(records[: min(2500, len(records))], max(2, iterations))
        print(f"[extra] memory pipeline finished in {time.time() - t0:.2f}s: {memory_result}")

        digest = hashlib.sha256(
            json.dumps(
                {
                    "cpu": cpu_result,
                    "disk": disk_result,
                    "network": network_result,
                    "memory": memory_result,
                },
                sort_keys=True,
            ).encode("utf-8")
        ).hexdigest()
        print(f"final_digest={digest}")
    finally:
        if server is not None:
            server.shutdown()
            server.server_close()
        elapsed = time.time() - start
        print(f"complex demo completed in {elapsed:.2f}s")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the complex EcoTrace verification demo.")
    parser.add_argument("--iterations", type=int, default=3, help="Higher values increase CPU and disk work.")
    parser.add_argument("--records", type=int, default=3500, help="Number of synthetic records to materialize.")
    parser.add_argument("--network-rounds", type=int, default=10, help="Number of local HTTP request/response cycles.")
    args = parser.parse_args()
    run_demo(args.iterations, args.records, args.network_rounds)


if __name__ == "__main__":
    main()
