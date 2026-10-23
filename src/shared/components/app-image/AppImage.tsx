import React from 'react';

interface AppImageProps extends React.ComponentProps<'img'> {
  src: string;
  alt: string;
}

export const AppImage: React.FC<AppImageProps> = ({ src, alt, className, ...props }) => {
  const resolveSrc = (originalSrc: string) => {
    if (import.meta.env.DEV) {
      return originalSrc;
    }

    // 1. Якщо це компонентна картинка (наприклад, /components/header/images/logo.png)
    const compMatch = originalSrc.match(/components\/([^/]+)\/images\/(.+)/);
    if (compMatch) {
      const [, compName, filePath] = compMatch;
      return `/images/${compName.toLowerCase()}/${filePath}`;
    }

    // 2. Якщо це глобальна картинка (наприклад, assets/images/logo-global.png)
    const globalMatch = originalSrc.match(/assets\/images\/(?:src\/)?(.+)/);
    if (globalMatch) {
      const [, filePath] = globalMatch;
      return `/images/${filePath}`;
    }

    return originalSrc;
  };

  const finalSrc = resolveSrc(src);

  if (import.meta.env.DEV) {
    return <img src={finalSrc} alt={alt} className={className} {...props} />;
  }

  const lastDot = finalSrc.lastIndexOf('.');
  const basePath = lastDot !== -1 ? finalSrc.substring(0, lastDot) : finalSrc;
  const ext = lastDot !== -1 ? finalSrc.substring(lastDot) : '';

  if (ext === '.svg') {
    return <img src={finalSrc} alt={alt} className={className} {...props} />;
  }

  return (
    <picture className={className}>
      <source srcSet={`${basePath}.avif`} type="image/avif" />
      <source srcSet={`${basePath}.webp`} type="image/webp" />
      <img src={finalSrc} alt={alt} loading="lazy" {...props} />
    </picture>
  );
};
