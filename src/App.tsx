import { useEffect, useRef, useState } from "react";
import { v4 as uuid } from "uuid";

/* ---------------- TYPES ---------------- */

type DrawEventInput =
  | { type: "stroke_start"; x: number; y: number }
  | { type: "stroke_move"; x: number; y: number }
  | { type: "stroke_end" };

type DrawEvent = DrawEventInput & {
  id: string; // global identity
  seq: number; // ordering hint
  source: "local" | "remote";
};

/* ---------------- APP ---------------- */

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [events, setEvents] = useState<DrawEvent[]>([]);
  const seenEventIds = useRef<Set<string>>(new Set());

  const [isDrawing, setIsDrawing] = useState(false);
  const seqRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current!;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    redraw(events);
  }, [events]);

  const getContext = () => {
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#000";
    return ctx;
  };

  const redraw = (events: DrawEvent[]) => {
    const ctx = getContext();
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    const ordered = [...events].sort((a, b) => a.seq - b.seq);

    for (const event of ordered) {
      switch (event.type) {
        case "stroke_start":
          ctx.beginPath();
          ctx.moveTo(event.x, event.y);
          break;
        case "stroke_move":
          ctx.lineTo(event.x, event.y);
          ctx.stroke();
          break;
        case "stroke_end":
          ctx.closePath();
          break;
      }
    }
  };

  /* ---------------- EVENT INGESTION ---------------- */

  const ingestEvent = (event: DrawEvent) => {
    if (seenEventIds.current.has(event.id)) {
      return; // ❌ duplicate — reject
    }

    seenEventIds.current.add(event.id);
    setEvents((prev) => [...prev, event]);
  };

  /* ---------------- LOCAL INPUT ---------------- */

  const createLocalEvent = (data: DrawEventInput): DrawEvent => ({
    ...data,
    id: uuid(),
    seq: seqRef.current++,
    source: "local",
  });

  const addLocalEvent = (input: DrawEventInput) => {
    const event = createLocalEvent(input);
    ingestEvent(event);
    simulateRemoteChaos(event);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    addLocalEvent({ type: "stroke_start", x: e.clientX, y: e.clientY });
    setIsDrawing(true);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    addLocalEvent({ type: "stroke_move", x: e.clientX, y: e.clientY });
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    addLocalEvent({ type: "stroke_end" });
    setIsDrawing(false);
  };

  /* ---------------- CHAOS MODE ---------------- */

  const simulateRemoteChaos = (event: DrawEvent) => {
    const copies = Math.floor(Math.random() * 3) + 1;

    for (let i = 0; i < copies; i++) {
      const delay = Math.random() * 1500;

      setTimeout(() => {
        const remoteCopy: DrawEvent = {
          ...event,
          source: "remote",
        };

        ingestEvent(remoteCopy);
      }, delay);
    }
  };

  return (
    <canvas
      ref={canvasRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={stopDrawing}
      onMouseLeave={stopDrawing}
      style={{ display: "block" }}
    />
  );
}
