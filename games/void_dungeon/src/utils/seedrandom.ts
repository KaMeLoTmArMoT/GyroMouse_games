export class SeededRandom {
	private state: number;

	constructor(seedStr: string | number) {
		this.state =
			typeof seedStr === "number" ? seedStr : this.hashString(seedStr);
	}

	private hashString(str: string): number {
		let hash = 0x811c9dc5;
		for (let i = 0; i < str.length; i++) {
			hash ^= str.charCodeAt(i);
			hash = Math.imul(hash, 0x01000193);
		}
		return hash >>> 0;
	}

	public next(): number {
		let t = (this.state += 0x6d2b79f5);
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}

	public nextInt(min: number, max: number): number {
		return Math.floor(this.next() * (max - min + 1)) + min;
	}

	public nextBool(probability: number = 0.5): number {
		return this.next() < probability ? 1 : 0;
	}

	public choice<T>(arr: T[]): T {
		return arr[Math.floor(this.next() * arr.length)];
	}
}
