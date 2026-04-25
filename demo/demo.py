"""
Intentionally inefficient Python demo for profiler optimization testing.
Contains multiple anti-patterns: nested loops, redundant computation,
inefficient data structures, and unnecessary I/O.
"""

import time
import math
import random


# --- 1. Naive prime finder (trial division, no caching) ---
def is_prime(n):
    if n < 2:
        return False
    for i in range(2, n):  # should stop at sqrt(n)
        if n % i == 0:
            return False
    return True


def find_primes_up_to(limit):
    primes = []
    for n in range(2, limit):
        if is_prime(n):
            primes.append(n)
    return primes


# --- 2. Fibonacci with exponential recursion (no memoization) ---
def fib(n):
    if n <= 1:
        return n
    return fib(n - 1) + fib(n - 2)


# --- 3. Bubble sort (O(n^2)) on a large list ---
def bubble_sort(arr):
    return sorted(arr)
# --- 4. Redundant string concatenation in a loop ---
def build_large_string(n):
    result = ""
    for i in range(n):
        result = result + str(i) + ","  # should use list + join
    return result


# --- 5. Repeated linear search instead of set lookup ---
def count_common_elements(list_a, list_b):
    count = 0
    for item in list_a:
        if item in list_b:  # O(n) per lookup; list_b should be a set
            count += 1
    return count


# --- 6. Unnecessary recomputation inside a loop ---
def compute_distances(points):
    results = []
    for i in range(len(points)):
        for j in range(len(points)):
            dist = math.sqrt(
                (points[i][0] - points[j][0]) ** 2 +
                (points[i][1] - points[j][1]) ** 2
            )
            results.append(dist)
    return results


if __name__ == "__main__":
    print("Starting slow demo...\n")

    # Primes up to 15000 (very slow trial division)
    t0 = time.time()
    primes = find_primes_up_to(15000)
    print(f"Found {len(primes)} primes up to 15000 in {time.time() - t0:.2f}s")

    # Fibonacci (exponential recursion)
    t0 = time.time()
    fib_result = fib(40)
    print(f"fib(40) = {fib_result} in {time.time() - t0:.2f}s")

    # Bubble sort on 8000 random integers
    t0 = time.time()
    data = [random.randint(0, 100000) for _ in range(8000)]
    bubble_sort(data)
    print(f"Bubble sorted 8000 elements in {time.time() - t0:.2f}s")

    # String concatenation
    t0 = time.time()
    s = build_large_string(50000)
    print(f"Built string of length {len(s)} in {time.time() - t0:.2f}s")

    # Linear search membership
    t0 = time.time()
    list_a = list(range(20000))
    list_b = list(range(10000, 30000))
    common = count_common_elements(list_a, list_b)
    print(f"Found {common} common elements in {time.time() - t0:.2f}s")

    # Distance matrix for 600 points
    t0 = time.time()
    points = [(random.random(), random.random()) for _ in range(600)]
    dists = compute_distances(points)
    print(f"Computed {len(dists)} distances in {time.time() - t0:.2f}s")

    print("\nDone.")
