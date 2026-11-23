"use client";

import React from "react";

export function FreetingEmptyIllustration() {
  return (
    <svg
      width="260"
      height="155"
      viewBox="0 0 260 155"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Ilustração de agenda livre"
      className="mx-auto select-none"
    >
      <defs>
        <linearGradient id="cupGrad" x1="100" y1="82" x2="136" y2="128" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FDD835" />
          <stop offset="65%" stopColor="#F9A825" />
          <stop offset="100%" stopColor="#F48FB1" />
        </linearGradient>
        <linearGradient id="pencilGrad" x1="138" y1="28" x2="160" y2="128" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFF176" />
          <stop offset="100%" stopColor="#FDD835" />
        </linearGradient>
      </defs>

      {/* Steam curve above coffee cup */}
      <path
        d="M98 66C92 55 112 45 103 33C96 24 72 22 69 36"
        stroke="#3C4043"
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
      />

      {/* Minimalist flying birds */}
      <path
        d="M150 28C155 21 162 24 164 31C167 23 175 21 180 27"
        stroke="#3C4043"
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M180 44C183 39 188 41 190 45"
        stroke="#3C4043"
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
      />

      {/* Golden Sun */}
      <circle cx="204" cy="24" r="9" fill="#FDD835" />

      {/* Left Pink Semicircle Shape */}
      <path
        d="M47 91C73 91 93 108 93 130H47V91Z"
        fill="#F8BBD0"
        stroke="#3C4043"
        strokeWidth="1.3"
      />

      {/* Tablet / Screen Frame on the Right */}
      <polygon
        points="166,70 232,70 219,130 153,130"
        fill="#FFFFFF"
        stroke="#3C4043"
        strokeWidth="1.4"
      />
      <polygon
        points="232,70 237,70 224,130 219,130"
        fill="#F8BBD0"
        stroke="#3C4043"
        strokeWidth="1.2"
      />
      {/* Video camera icon inside tablet */}
      <rect
        x="175"
        y="89"
        width="24"
        height="19"
        rx="3"
        stroke="#3C4043"
        strokeWidth="1.3"
        fill="none"
      />
      <polygon
        points="199,95 210,88 210,108 199,101"
        stroke="#3C4043"
        strokeWidth="1.3"
        fill="none"
      />

      {/* Coffee Cup */}
      <path
        d="M95 85H137V108C137 120 127 130 116 130C105 130 95 120 95 108V85Z"
        fill="url(#cupGrad)"
        stroke="#3C4043"
        strokeWidth="1.4"
      />

      {/* Tilted Yellow Pencil */}
      <g transform="rotate(-14 148 80)">
        <rect
          x="144"
          y="42"
          width="8"
          height="86"
          fill="url(#pencilGrad)"
          stroke="#3C4043"
          strokeWidth="1.3"
        />
        <polygon
          points="144,42 148,26 152,42"
          fill="#FFF9C4"
          stroke="#3C4043"
          strokeWidth="1.3"
        />
        <polygon points="146.5,32 148,26 149.5,32" fill="#3C4043" />
      </g>

      {/* Bottom Baseline */}
      <line
        x1="44"
        y1="130"
        x2="236"
        y2="130"
        stroke="#3C4043"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
