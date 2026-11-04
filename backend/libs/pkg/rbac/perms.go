// Package rbac is the Discord-style role and permission model (ADR-0066): permission
// bit sets, role rank and hierarchy, and the overwrite resolution algorithm. It is pure
// computation with no storage, so the user service, its database triggers' tests and the
// shadow comparison against Casbin all share one definition.
package rbac

import (
	"fmt"
	"math/bits"
	"strings"
)

// Width is the number of permission bits; it matches the bit(256) database columns.
const Width = 256

const words = Width / 64

// Perms is a set of permission flags. Bit i is the flag with registry index i.
type Perms [words]uint64

// Bit returns the set containing only flag index.
func Bit(index int) Perms {
	var p Perms
	return p.With(index)
}

// Of returns the set containing the given flag indexes.
func Of(indexes ...int) Perms {
	var p Perms
	for _, index := range indexes {
		p = p.With(index)
	}
	return p
}

// All is every flag.
func All() Perms {
	var p Perms
	for i := range p {
		p[i] = ^uint64(0)
	}
	return p
}

func (p Perms) With(index int) Perms {
	if index < 0 || index >= Width {
		panic(fmt.Sprintf("rbac: permission index %d out of range", index))
	}
	p[index/64] |= 1 << (index % 64)
	return p
}

func (p Perms) Has(index int) bool {
	return index >= 0 && index < Width && p[index/64]&(1<<(index%64)) != 0
}

func (p Perms) Or(other Perms) Perms {
	for i := range p {
		p[i] |= other[i]
	}
	return p
}

func (p Perms) And(other Perms) Perms {
	for i := range p {
		p[i] &= other[i]
	}
	return p
}

// AndNot clears every flag set in other.
func (p Perms) AndNot(other Perms) Perms {
	for i := range p {
		p[i] &^= other[i]
	}
	return p
}

func (p Perms) IsZero() bool { return p == Perms{} }

// Count is the number of flags set.
func (p Perms) Count() int {
	n := 0
	for _, w := range p {
		n += bits.OnesCount64(w)
	}
	return n
}

// Covers reports whether every flag in other is also in p (other is a subset of p).
func (p Perms) Covers(other Perms) bool { return other.AndNot(p).IsZero() }

// BitString is the PostgreSQL bit(256) text form: character i is flag index i.
func (p Perms) BitString() string {
	var b strings.Builder
	b.Grow(Width)
	for i := 0; i < Width; i++ {
		if p.Has(i) {
			b.WriteByte('1')
		} else {
			b.WriteByte('0')
		}
	}
	return b.String()
}

// ParseBitString reads the form BitString writes.
func ParseBitString(text string) (Perms, error) {
	var p Perms
	if len(text) != Width {
		return p, fmt.Errorf("rbac: bit string has %d characters, want %d", len(text), Width)
	}
	for i := 0; i < Width; i++ {
		switch text[i] {
		case '1':
			p = p.With(i)
		case '0':
		default:
			return Perms{}, fmt.Errorf("rbac: bit string has %q at %d", text[i], i)
		}
	}
	return p, nil
}
