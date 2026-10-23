import { useEffect } from 'react';

export function useSvgSprite(): void {
  useEffect(() => {
    if (document.getElementById('svg-sprite-container')) return;

    const STORAGE_KEY = 'cached_svg_sprite';
    const VERSION_KEY = 'cached_svg_sprite_version';
    const CURRENT_VERSION = '1.0';

    const loadSprite = async (): Promise<void> => {
      let spriteData: string | null = null;

      if (!import.meta.env.DEV) {
        const savedVersion = localStorage.getItem(VERSION_KEY);
        if (savedVersion === CURRENT_VERSION) {
          spriteData = localStorage.getItem(STORAGE_KEY);
        }
      }

      if (!spriteData) {
        try {
          const spritePath = import.meta.env.DEV
            ? '/assets/images/sprite.svg'
            : './images/sprite.svg';

          const response = await fetch(spritePath);
          if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

          spriteData = await response.text();

          if (!import.meta.env.DEV) {
            localStorage.setItem(STORAGE_KEY, spriteData);
            localStorage.setItem(VERSION_KEY, CURRENT_VERSION);
          }
        } catch (error) {
          console.error('[SvgSprite] Помилка завантаження спрайту:', error);
          return;
        }
      }

      const div = document.createElement('div');
      div.id = 'svg-sprite-container';
      div.style.display = 'none';
      div.innerHTML = spriteData;

      document.body.appendChild(div);
    };

    void loadSprite();
  }, []);
}
