"""
Test file for EcoSpec integration with VS Code extension.
This file contains code with different complexity levels.
"""

# O(n²) complexity - should trigger medium/high warning
def nested_loops():
    result = 0
    for i in range(1000):
        for j in range(1000):
            result += i * j
    return result

# O(n³) complexity - should trigger high warning
def triple_nested():
    result = 0
    for i in range(100):
        for j in range(100):
            for k in range(100):
                result += i * j * k
    return result

# O(n) complexity - should be low warning
def simple_loop():
    result = 0
    for i in range(10000):
        result += i
    return result

if __name__ == '__main__':
    print(nested_loops())
    print(triple_nested())
    print(simple_loop())
