export type TurnPhase =
  | 'MOVE'
  | 'WEAPON_SELECT'
  | 'AIM_FIRE'
  | 'PROJECTILE_FLIGHT'
  | 'TURN_RESOLVE'
  | 'GAME_OVER';

export type MaterialType =
  | 'bedrock'
  | 'stone'
  | 'dirt'
  | 'grass'
  | 'sand'
  | 'water'
  | 'acid';

export type WeaponId =
  | 'bazooka'
  | 'grenade'
  | 'cluster'
  | 'acid_bomb'
  | 'sand_bomb'
  | 'portal_gun'
  | 'shotgun';

export interface WeaponInfo {
  id: WeaponId;
  name: string;
  icon: string;
  description: string;
  fuseSelectable?: boolean;
  affectedByWind: boolean;
}

export type AIDifficulty = 'easy' | 'normal' | 'hard';

export interface Vector2D {
  x: number;
  y: number;
}

export interface Portal {
  id: 'orange' | 'blue';
  x: number;
  y: number;
  normalX: number;
  normalY: number;
  radius: number;
}

export interface TerrainColumn {
  grassY: number;
  dirtY: number;
  stoneY: number;
  bedrockY: number;
  sandY: number;
  destruction: {
    grass: number;
    dirt: number;
    stone: number;
    sand: number;
  };
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
  isAcid?: boolean;
}
