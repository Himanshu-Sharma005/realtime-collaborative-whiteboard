import { useEffect, useRef, useState } from "react";
import { v4 as uuid } from "uuid";

/* ---------------- TYPES ---------------- */

// Durable drawing events (event-sourced)
type DrawEventInput =
  | { type: "stroke_start"; x: number; y: number }
  | { type: "stroke_move"; x: number; y: number }
  | { type: "stroke_end" };

type DrawEvent = DrawEventInput & {
  id: string;
  seq: number;
};

// Ephemeral cursor presence (NOT event-sourced)
type CursorPresence = {
  userId: string;
  x: number;
  y: number;
  color: string;
};

/* ---------------- APP ---------------- */

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<WebSocket | null>(null);

  // Session-only identity (no auth)
  const userIdRef = useRef(uuid().slice(0, 6));
  const userColorRef = useRef(
    `hsl(${Math.floor(Math.random() * 360)}, 70%, 50%)`
  );

  // Event-sourced drawing state
  const [events, setEvents] = useState<DrawEvent[]>([]);
  const seenEventIds = useRef<Set<string>>(new Set());
  const seqRef = useRef(0);

  // Cursor presence state (ephemeral)
  const [cursors, setCursors] = useState<Record<string, CursorPresence>>({});

  const [isDrawing, setIsDrawing] = useState(false);

  /* ---------------- SETUP ---------------- */

  useEffect(() => {
    const canvas = canvasRef.current!;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    redraw(events);
  }, [events]);

  useEffect(() => {
    const socket = new WebSocket("ws://localhost:8080");
    socketRef.current = socket;

    socket.onmessage = (msg) => {
      const data = JSON.parse(msg.data);

      // Cursor presence message
      if (data.type === "cursor") {
        if (data.userId === userIdRef.current) return; // ignore self
        setCursors((prev) => ({
          ...prev,
          [data.userId]: data,
        }));
        return;
      }

      // Drawing event
      ingestEvent(data);
    };

    return () => socket.close();
  }, []);

  /* ---------------- CANVAS ---------------- */

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
    if (seenEventIds.current.has(event.id)) return;
    seenEventIds.current.add(event.id);
    setEvents((prev) => [...prev, event]);
  };

  const createLocalEvent = (data: DrawEventInput): DrawEvent => ({
    ...data,
    id: uuid(),
    seq: seqRef.current++,
  });

  const addLocalEvent = (input: DrawEventInput) => {
    const event = createLocalEvent(input);
    ingestEvent(event);
    socketRef.current?.send(JSON.stringify(event));
  };

  /* ---------------- INPUT ---------------- */

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    addLocalEvent({ type: "stroke_start", x: e.clientX, y: e.clientY });
    setIsDrawing(true);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // Cursor presence (ephemeral)
    socketRef.current?.send(
      JSON.stringify({
        type: "cursor",
        userId: userIdRef.current,
        x: e.clientX,
        y: e.clientY,
        color: userColorRef.current,
      })
    );

    // Drawing
    if (!isDrawing) return;
    addLocalEvent({ type: "stroke_move", x: e.clientX, y: e.clientY });
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    addLocalEvent({ type: "stroke_end" });
    setIsDrawing(false);
  };

  /* ---------------- RENDER ---------------- */

  return (
    <div style={{ position: "relative" }}>
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        style={{ display: "block" }}
      />

      {/* Cursor overlays */}
      {Object.values(cursors).map((cursor) => (
        <div
          key={cursor.userId}
          style={{
            position: "absolute",
            left: cursor.x,
            top: cursor.y,
            width: 10,
            height: 10,
            borderRadius: "50%",
            backgroundColor: cursor.color,
            pointerEvents: "none",
            transform: "translate(-50%, -50%)",
          }}
        />
      ))}
    </div>
  );
}
