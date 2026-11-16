import sys
def load(path):
    L = open(path).read().split()
    assert L[0] == 'MAX7456'
    bits = L[1:]
    glyphs = []
    for g in range(256):
        rows = bits[g*64:g*64+54]
        px = []
        for b in rows:
            for k in range(4):
                px.append(b[k*2:k*2+2])
        glyphs.append([px[r*12:(r+1)*12] for r in range(18)])
    return glyphs
if __name__ == '__main__':
    G = load(sys.argv[1])
    for c in [int(x, 0) for x in sys.argv[2:]]:
        print(hex(c), repr(chr(c)))
        for row in G[c]:
            print(''.join('#' if p == '10' else ('.' if p == '00' else ' ') for p in row))
