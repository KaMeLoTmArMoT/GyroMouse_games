export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface QuadItem extends Rect {
	id: string;
}

export class QuadTree<T extends QuadItem> {
	public bounds: Rect;
	public capacity: number;
	public maxDepth: number;
	public depth: number;
	public items: T[] = [];
	public divided: boolean = false;

	public topLeft: QuadTree<T> | null = null;
	public topRight: QuadTree<T> | null = null;
	public bottomLeft: QuadTree<T> | null = null;
	public bottomRight: QuadTree<T> | null = null;

	constructor(
		bounds: Rect,
		capacity: number = 8,
		maxDepth: number = 5,
		depth: number = 0,
	) {
		this.bounds = bounds;
		this.capacity = capacity;
		this.maxDepth = maxDepth;
		this.depth = depth;
	}

	public clear(): void {
		this.items.length = 0;
		if (this.divided) {
			this.topLeft?.clear();
			this.topRight?.clear();
			this.bottomLeft?.clear();
			this.bottomRight?.clear();
			this.divided = false;
		}
	}

	private subdivide(): void {
		const { x, y, width, height } = this.bounds;
		const halfW = width / 2;
		const halfH = height / 2;
		const nextDepth = this.depth + 1;

		this.topLeft = new QuadTree<T>(
			{ x, y, width: halfW, height: halfH },
			this.capacity,
			this.maxDepth,
			nextDepth,
		);
		this.topRight = new QuadTree<T>(
			{ x: x + halfW, y, width: halfW, height: halfH },
			this.capacity,
			this.maxDepth,
			nextDepth,
		);
		this.bottomLeft = new QuadTree<T>(
			{ x, y: y + halfH, width: halfW, height: halfH },
			this.capacity,
			this.maxDepth,
			nextDepth,
		);
		this.bottomRight = new QuadTree<T>(
			{ x: x + halfW, y: y + halfH, width: halfW, height: halfH },
			this.capacity,
			this.maxDepth,
			nextDepth,
		);
		this.divided = true;
	}

	public insert(item: T): boolean {
		if (!this.intersects(this.bounds, item)) {
			return false;
		}

		if (this.items.length < this.capacity || this.depth >= this.maxDepth) {
			this.items.push(item);
			return true;
		}

		if (!this.divided) {
			this.subdivide();
		}

		return (
			(this.topLeft?.insert(item) ?? false) ||
			(this.topRight?.insert(item) ?? false) ||
			(this.bottomLeft?.insert(item) ?? false) ||
			(this.bottomRight?.insert(item) ?? false)
		);
	}

	public queryRange(range: Rect, result: T[] = []): T[] {
		if (!this.intersects(this.bounds, range)) {
			return result;
		}

		for (const item of this.items) {
			if (this.intersects(range, item)) {
				result.push(item);
			}
		}

		if (this.divided) {
			this.topLeft?.queryRange(range, result);
			this.topRight?.queryRange(range, result);
			this.bottomLeft?.queryRange(range, result);
			this.bottomRight?.queryRange(range, result);
		}

		return result;
	}

	private intersects(a: Rect, b: Rect): boolean {
		return !(
			b.x >= a.x + a.width ||
			b.x + b.width <= a.x ||
			b.y >= a.y + a.height ||
			b.y + b.height <= a.y
		);
	}
}
