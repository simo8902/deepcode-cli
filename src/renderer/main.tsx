import React from "react";
import { createRoot } from "react-dom/client";
import { AlienApp } from "./App";
import "./alien-theme.css";

const container = document.getElementById("root");
if (!container) throw new Error("Root container not found");

createRoot(container).render(
  <React.StrictMode>
    <AlienApp />
  </React.StrictMode>
);
