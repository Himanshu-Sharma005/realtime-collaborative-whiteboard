import { useEffect, useRef, useState } from "react";
import { v4 as uuid } from "uuid";

/* ================= TYPES ================= */

type DrawEventInput =
  | { type: "stroke_start"; strokeId: string; x: number; y: number }
  | { type: "stroke_move"; strokeId: string; x: number; y: number }
  | { type: "stroke_end"; strokeId: string };

type UndoEvent = { type: "undo"; targetStrokeId: string };
type RedoEvent = { type: "redo"; targetUndoEventId: string };

type WhiteboardEvent = DrawEventInput | UndoEvent | RedoEvent;

type StoredEvent = WhiteboardEvent & {
  id: string;
  seq: number;
  userId: string;
};

type CursorPresence = {
  userId: string;
  x: number;
  y: number;
  color: string;
};

/* ================= APP ================= */

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const userIdRef = useRef(uuid().slice(0, 6));
  const userColorRef = useRef(
    `hsl(${Math.floor(Math.random() * 360)}, 70%, 50%)`
  );

  const [events, setEvents] = useState<StoredEvent[]>([]);
  const seenEventIds = useRef<Set<string>>(new Set());
  const seqRef = useRef(0);

  const [cursors, setCursors] = useState<Record<string, CursorPresence>>({});
  const [isDrawing, setIsDrawing] = useState(false);
  const currentStrokeId = useRef<string | null>(null);

  const [connectionStatus, setConnectionStatus] = useState("Connecting…");

  /* ================= SETUP ================= */

  useEffect(() => {
    const canvas = canvasRef.current!;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    redraw(events);
  }, [events]);

  useEffect(() => {
    const socket = new WebSocket("ws://localhost:8080");
    socketRef.current = socket;

    socket.onopen = () => setConnectionStatus("Realtime connected");
    socket.onclose = () => setConnectionStatus("Disconnected");

    socket.onmessage = (msg) => {
      const data = JSON.parse(msg.data);

      if (data.type === "cursor") {
        if (data.userId === userIdRef.current) return;
        setCursors((prev) => ({ ...prev, [data.userId]: data }));
        return;
      }

      ingestEvent(data);
    };

    return () => socket.close();
  }, []);

  /* ================= CANVAS ================= */

  const getContext = () => {
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#000";
    return ctx;
  };

  const redraw = (events: StoredEvent[]) => {
    const ctx = getContext();
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    const ordered = [...events].sort((a, b) => a.seq - b.seq);

    const undoneStrokes = new Set<string>();
    const redoneUndoIds = new Set<string>();

    for (const e of ordered) {
      if (e.type === "redo") redoneUndoIds.add(e.targetUndoEventId);
    }

    for (const e of ordered) {
      if (e.type === "undo" && !redoneUndoIds.has(e.id)) {
        undoneStrokes.add(e.targetStrokeId);
      }
    }

    for (const e of ordered) {
      if ("strokeId" in e && undoneStrokes.has(e.strokeId)) continue;

      switch (e.type) {
        case "stroke_start":
          ctx.beginPath();
          ctx.moveTo(e.x, e.y);
          break;
        case "stroke_move":
          ctx.lineTo(e.x, e.y);
          ctx.stroke();
          break;
        case "stroke_end":
          ctx.closePath();
          break;
      }
    }
  };

  /* ================= EVENT CORE ================= */

  const ingestEvent = (event: StoredEvent) => {
    if (seenEventIds.current.has(event.id)) return;
    seenEventIds.current.add(event.id);
    setEvents((prev) => [...prev, event]);
  };

  const createEvent = (data: WhiteboardEvent): StoredEvent => ({
    ...data,
    id: uuid(),
    seq: seqRef.current++,
    userId: userIdRef.current,
  });

  const broadcastEvent = (event: StoredEvent) => {
    ingestEvent(event);
    socketRef.current?.send(JSON.stringify(event));
  };

  /* ================= DRAWING ================= */

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const strokeId = uuid();
    currentStrokeId.current = strokeId;

    broadcastEvent(
      createEvent({
        type: "stroke_start",
        strokeId,
        x: e.clientX,
        y: e.clientY,
      })
    );

    setIsDrawing(true);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    socketRef.current?.send(
      JSON.stringify({
        type: "cursor",
        userId: userIdRef.current,
        x: e.clientX,
        y: e.clientY,
        color: userColorRef.current,
      })
    );

    if (!isDrawing || !currentStrokeId.current) return;

    broadcastEvent(
      createEvent({
        type: "stroke_move",
        strokeId: currentStrokeId.current,
        x: e.clientX,
        y: e.clientY,
      })
    );
  };

  const stopDrawing = () => {
    if (!isDrawing || !currentStrokeId.current) return;

    broadcastEvent(
      createEvent({
        type: "stroke_end",
        strokeId: currentStrokeId.current,
      })
    );

    currentStrokeId.current = null;
    setIsDrawing(false);
  };

  /* ================= UNDO / REDO ================= */

  const handleUndo = () => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === "stroke_end" && e.userId === userIdRef.current) {
        broadcastEvent(
          createEvent({ type: "undo", targetStrokeId: e.strokeId })
        );
        break;
      }
    }
  };

  const handleRedo = () => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === "undo" && e.userId === userIdRef.current) {
        broadcastEvent(createEvent({ type: "redo", targetUndoEventId: e.id }));
        break;
      }
    }
  };

  /* ================= RENDER ================= */

  return (
    <div className="relative w-screen h-screen bg-gray-50 overflow-hidden">
      {/* Toolbar */}
      <div className="absolute top-4 left-4 z-10 flex items-center gap-2 rounded-xl bg-white px-3 py-2 shadow-lg border">
        <button
          onClick={handleUndo}
          className="px-3 py-1 rounded-md bg-gray-100 hover:bg-gray-200 text-sm font-medium"
        >
          Undo
        </button>
        <button
          onClick={handleRedo}
          className="px-3 py-1 rounded-md bg-gray-100 hover:bg-gray-200 text-sm font-medium"
        >
          Redo
        </button>
        <div className="ml-2 text-xs text-gray-500">{connectionStatus}</div>
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        className="block"
      />

      {/* Cursors */}
      {Object.values(cursors).map((cursor) => (
        <div
          key={cursor.userId}
          className="absolute w-3 h-3 rounded-full pointer-events-none"
          style={{
            left: cursor.x,
            top: cursor.y,
            backgroundColor: cursor.color,
            transform: "translate(-50%, -50%)",
          }}
        />
      ))}
    </div>
  );
}
