"use client";

import dynamic from "next/dynamic";

// next/dynamic's ssr:false only works from a Client Component — this thin
// wrapper is that boundary so the server-component page can still use it.
export const DynamicRejoinFromStorage = dynamic(
  () => import("./RejoinFromStorage").then((mod) => mod.RejoinFromStorage),
  { ssr: false }
);
