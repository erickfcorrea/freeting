"use client";

import React from "react";

export function FreetingEmptyIllustration() {
  return (
    <svg
      width="220"
      height="120"
      viewBox="0 0 220 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Estúdio livre e pronto para iniciar"
      className="mx-auto select-none"
    >
      <rect
        x="24"
        y="16"
        width="172"
        height="88"
        rx="22"
        fill="currentColor"
        fillOpacity="0.04"
        stroke="currentColor"
        strokeOpacity="0.14"
        strokeWidth="1.5"
      />
      <circle cx="110" cy="60" r="28" fill="#10B981" fillOpacity="0.12" />
      <circle
        cx="110"
        cy="60"
        r="27"
        stroke="#10B981"
        strokeOpacity="0.45"
        strokeWidth="1.5"
        strokeDasharray="4 4"
      />
      {/* Acoustic Studio Bars */}
      <rect x="92" y="52" width="5" height="16" rx="2.5" fill="#10B981" />
      <rect x="102" y="43" width="5" height="34" rx="2.5" fill="#34D399" />
      <rect x="112" y="47" width="5" height="26" rx="2.5" fill="#F59E0B" />
      <rect x="122" y="54" width="5" height="12" rx="2.5" fill="#10B981" />
      {/* Subtle Corner Telemetry Dots */}
      <circle cx="42" cy="34" r="3" fill="#10B981" />
      <circle cx="52" cy="34" r="3" fill="#F59E0B" fillOpacity="0.7" />
    </svg>
  );
}
