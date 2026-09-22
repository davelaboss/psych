'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { InventoryStatus } from '@/lib/types';

const MAX_SCALE = 6;

export function ImageLightbox({ images, title, initialIndex = 0, onClose }: { images: string[]; title: string; initialIndex?: number; onClose: () => void }) {
  const [index, setIndex] = useState(Math.min(Math.max(initialIndex, 0), Math.max(images.length - 1, 0)));
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ distance: 0, scale: 1 });
  const hasMany = images.length > 1;
  function resetView() { setScale(1); setPan({ x: 0, y: 0 }); }
  function changeScale(next: number) {
    const bounded = Math.min(MAX_SCALE, Math.max(1, next));
    setScale(bounded);
    if (bounded === 1) setPan({ x: 0, y: 0 });
  }
  function selectImage(next: number) { setIndex(next); resetView(); }
  const previous = () => selectImage((index - 1 + images.length) % images.length);
  const next = () => selectImage((index + 1) % images.length);

  useEffect(() => {
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft' && hasMany) setIndex((current) => { resetView(); return (current - 1 + images.length) % images.length; });
      if (event.key === 'ArrowRight' && hasMany) setIndex((current) => { resetView(); return (current + 1) % images.length; });
      if (event.key === '+' || event.key === '=') changeScale(scale + .35);
      if (event.key === '-') changeScale(scale - .35);
      if (event.key === '0') resetView();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); document.body.style.overflow = oldOverflow; };
  }, [hasMany, images.length, onClose, scale]);

  function pointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointers.current.values()];
    gesture.current = { distance: points.length > 1 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0, scale };
  }
  function pointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const prior = pointers.current.get(event.pointerId);
    if (!prior) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const points = [...pointers.current.values()];
    if (points.length > 1) {
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      if (gesture.current.distance) changeScale(gesture.current.scale * distance / gesture.current.distance);
    } else if (scale > 1) {
      setPan((current) => ({ x: current.x + event.clientX - prior.x, y: current.y + event.clientY - prior.y }));
    }
  }
  function pointerUp(event: React.PointerEvent<HTMLDivElement>) { pointers.current.delete(event.pointerId); }

  if (!images.length) return null;
  return createPortal(<div className="image-lightbox-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="image-lightbox" role="dialog" aria-modal="true" aria-label={`Fotos de ${title}`}>
      <header><div><strong>{title}</strong><span>Foto {index + 1} de {images.length}</span></div><button type="button" onClick={onClose} aria-label="Cerrar imagen ampliada">Cerrar ×</button></header>
      <div className="image-lightbox-toolbar" role="toolbar" aria-label="Controles de zoom"><button type="button" onClick={() => changeScale(scale - .35)} disabled={scale <= 1} aria-label="Alejar">−</button><span aria-live="polite">{Math.round(scale * 100)}%</span><button type="button" onClick={() => changeScale(scale + .35)} disabled={scale >= MAX_SCALE} aria-label="Acercar">+</button><button type="button" onClick={resetView}>Ajustar / Restablecer</button></div>
      <div className={`image-lightbox-stage ${scale > 1 ? 'is-zoomed' : ''}`} onWheel={(event) => { event.preventDefault(); changeScale(scale + (event.deltaY < 0 ? .25 : -.25)); }} onDoubleClick={() => scale === 1 ? changeScale(2) : resetView()} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
        {hasMany ? <button className="lightbox-arrow previous" type="button" onClick={previous} aria-label="Foto anterior">‹</button> : null}
        <img draggable={false} src={images[index]} alt={`${title}, foto ${index + 1}`} style={{ transform: `translate(${pan.x / scale}px, ${pan.y / scale}px) scale(${scale})` }} />
        {hasMany ? <button className="lightbox-arrow next" type="button" onClick={next} aria-label="Foto siguiente">›</button> : null}
      </div>
      {hasMany ? <nav className="image-lightbox-thumbnails" aria-label="Elegir fotografía">{images.map((image, imageIndex) => <button type="button" className={imageIndex === index ? 'active' : ''} key={`${image}-${imageIndex}`} onClick={() => selectImage(imageIndex)} aria-label={`Ver foto ${imageIndex + 1}`}><img src={image} alt="" /></button>)}</nav> : null}
    </section>
  </div>, document.body);
}

export function ProductImageGallery({ images, title, isDemo = false, status, className = '' }: { images: string[]; title: string; isDemo?: boolean; status?: InventoryStatus; className?: string }) {
  const [selected, setSelected] = useState(0);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  if (!images.length) return null;
  const sold = status === 'SOLD' || status === 'PICKED_UP';
  return <div className={`product-gallery full-image-gallery ${className}`.trim()}>
    <button className={`main-image ${sold ? 'is-sold' : ''}`} type="button" onClick={() => setLightboxIndex(selected)} aria-label={`Ampliar ${title}, foto ${selected + 1}`}><img src={images[selected]} alt={`${title}, foto ${selected + 1}`} />{sold ? <span className="sold-ribbon" aria-label="Vendido">VENDIDO</span> : null}{isDemo ? <span className="demo-flag">IMAGEN DE MUESTRA</span> : null}<span className="image-enlarge-hint">Ampliar foto</span></button>
    {images.length > 1 ? <nav className="product-gallery-thumbnails" aria-label="Fotografías del producto">{images.map((image, imageIndex) => <button type="button" className={selected === imageIndex ? 'active' : ''} key={`${image}-${imageIndex}`} onClick={() => { setSelected(imageIndex); setLightboxIndex(imageIndex); }} aria-label={`Ampliar foto ${imageIndex + 1}`}><img src={image} alt={`${title}, miniatura ${imageIndex + 1}`} loading={imageIndex ? 'lazy' : 'eager'} /></button>)}</nav> : null}
    {lightboxIndex !== null ? <ImageLightbox images={images} title={title} initialIndex={lightboxIndex} onClose={() => setLightboxIndex(null)} /> : null}
  </div>;
}
