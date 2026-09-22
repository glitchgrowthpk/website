import { GameProvider } from "@/lib/game-state";
import HudBar from "@/components/HudBar";
import PlayerLayer from "@/components/PlayerLayer";
import { ControlLayer, Konami, Toast } from "@/components/GameUi";
import Hero from "@/components/Hero";
import StatsHud from "@/components/StatsHud";
import Roster from "@/components/Roster";
import Portfolio from "@/components/Portfolio";
import Arcade from "@/components/Arcade";
import Pipeline from "@/components/Pipeline";
import Partner from "@/components/Partner";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <GameProvider>
      <HudBar />
      <PlayerLayer />
      <ControlLayer />
      <Toast />
      <Konami />

      <main id="main">
        <Hero />
        <StatsHud />
        <Roster />
        <Portfolio />
        <Arcade />
        <Pipeline />
        <Partner />
      </main>

      <Footer />
    </GameProvider>
  );
}
