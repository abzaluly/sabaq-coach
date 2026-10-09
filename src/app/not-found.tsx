import Link from "next/link";
import { Character } from "@/components/character";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <Character seed="lost" stage={1} mood="tired" size={120} />
      <h1 className="text-2xl font-extrabold">404</h1>
      <Button asChild>
        <Link href="/">Orle</Link>
      </Button>
    </main>
  );
}
