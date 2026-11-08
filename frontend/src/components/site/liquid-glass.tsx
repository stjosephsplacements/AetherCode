"use client";

import { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import { cn } from "@/lib/utils";

const FILTER_SVG_ID = "__lg_svg__";
let filterInstalled = false;

function installGlobalFilter() {
  if (filterInstalled || typeof document === "undefined") return;
  filterInstalled = true;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("id", FILTER_SVG_ID);
  svg.setAttribute("aria-hidden", "true");
  svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";

  svg.innerHTML = `<defs>
    <filter id="lg-refract" x="-5%" y="-5%" width="110%" height="110%"
            color-interpolation-filters="sRGB">
      <feGaussianBlur in="BackdropImage" stdDeviation="12" result="frost"/>
      <feColorMatrix in="frost" type="matrix"
        values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 100 -50" result="opaque"/>
      <feGaussianBlur in="SourceAlpha" stdDeviation="6" result="edgeBlur"/>
      <feColorMatrix in="edgeBlur" type="matrix"
        values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 1 0" result="edgeMap"/>
      <feDisplacementMap in="opaque" in2="edgeMap" scale="8"
        xChannelSelector="R" yChannelSelector="G" result="displaced"/>
      <feSpecularLighting in="edgeBlur" surfaceScale="2" specularConstant="0.6"
        specularExponent="25" lighting-color="white" result="specular">
        <fePointLight x="-0.1" y="-0.1" z="0.4"/>
      </feSpecularLighting>
      <feComposite in="specular" in2="SourceAlpha" operator="in" result="specMasked"/>
      <feColorMatrix in="specMasked" type="matrix"
        values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.35 0" result="specFaded"/>
      <feComposite in="specFaded" in2="displaced" operator="over" result="withSpec"/>
      <feColorMatrix in="withSpec" type="saturate" values="1.25" result="saturated"/>
      <feComposite in="saturated" in2="SourceGraphic" operator="in"/>
    </filter>
    <filter id="lg-refract-strong" x="-5%" y="-5%" width="110%" height="110%"
            color-interpolation-filters="sRGB">
      <feGaussianBlur in="BackdropImage" stdDeviation="18" result="frost"/>
      <feColorMatrix in="frost" type="matrix"
        values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 100 -50" result="opaque"/>
      <feGaussianBlur in="SourceAlpha" stdDeviation="8" result="edgeBlur"/>
      <feColorMatrix in="edgeBlur" type="matrix"
        values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 1 0" result="edgeMap"/>
      <feDisplacementMap in="opaque" in2="edgeMap" scale="12"
        xChannelSelector="R" yChannelSelector="G" result="displaced"/>
      <feSpecularLighting in="edgeBlur" surfaceScale="3" specularConstant="0.7"
        specularExponent="20" lighting-color="white" result="specular">
        <fePointLight x="-0.1" y="-0.1" z="0.5"/>
      </feSpecularLighting>
      <feComposite in="specular" in2="SourceAlpha" operator="in" result="specMasked"/>
      <feColorMatrix in="specMasked" type="matrix"
        values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.4 0" result="specFaded"/>
      <feComposite in="specFaded" in2="displaced" operator="over" result="withSpec"/>
      <feColorMatrix in="withSpec" type="saturate" values="1.3" result="saturated"/>
      <feComposite in="saturated" in2="SourceGraphic" operator="in"/>
    </filter>
  </defs>`;

  document.body.prepend(svg);
}

function supportsBackdropFilterURL(): boolean {
  if (typeof CSS === "undefined") return false;
  return CSS.supports("backdrop-filter", "url(#x)");
}

export type LiquidGlassProps = React.HTMLAttributes<HTMLDivElement> & {
  children?: React.ReactNode;
  strong?: boolean;
};

export const LiquidGlass = forwardRef<HTMLDivElement, LiquidGlassProps>(
  function LiquidGlass({ children, className, style, strong = false, ...htmlProps }, externalRef) {
    const innerRef = useRef<HTMLDivElement>(null);
    useImperativeHandle(externalRef, () => innerRef.current!);

    useEffect(() => {
      if (!supportsBackdropFilterURL()) return;
      installGlobalFilter();
      const el = innerRef.current;
      if (!el) return;

      const filterId = strong ? "lg-refract-strong" : "lg-refract";
      el.style.backdropFilter = `url(#${filterId})`;
      (el.style as CSSStyleDeclaration & { webkitBackdropFilter: string }).webkitBackdropFilter = `url(#${filterId})`;

      return () => {
        el.style.removeProperty("backdrop-filter");
        el.style.removeProperty("-webkit-backdrop-filter");
      };
    }, [strong]);

    return (
      <div
        ref={innerRef}
        className={cn(strong ? "liquid-glass-strong" : "liquid-glass", className)}
        style={style}
        {...htmlProps}
      >
        {children}
      </div>
    );
  },
);
