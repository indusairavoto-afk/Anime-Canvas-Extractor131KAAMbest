import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Topbar } from "@/components/topbar";
import { Sidebar } from "@/components/sidebar";
import { SidebarProvider } from "@/contexts/sidebar-context";
import { AuthProvider } from "@/contexts/auth-context";
import { ScrollToTop } from "@/components/scroll-to-top";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Browse from "@/pages/browse";
import AnimeDetail from "@/pages/anime-detail";
import AnimeDetailAniList from "@/pages/anime-detail-anilist";
import CharacterDetail from "@/pages/character-detail";
import Watch from "@/pages/watch";
import WatchAniList from "@/pages/watch-anilist";
import Community from "@/pages/community";
import CommunityPostDetail from "@/pages/community-post-detail";
import Schedule from "@/pages/schedule";
import Watchlist from "@/pages/watchlist";
import Ranking from "@/pages/ranking";
import AuthPage from "@/pages/auth";
import ProfilePage from "@/pages/profile";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/browse" component={Browse} />
      <Route path="/ranking" component={Ranking} />
      <Route path="/anime/al/:id" component={AnimeDetailAniList} />
      <Route path="/anime/:id" component={AnimeDetail} />
      <Route path="/character/:id" component={CharacterDetail} />
      <Route path="/watch/al/:animeId/:episode" component={WatchAniList} />
      <Route path="/watch/:episodeId" component={Watch} />
      <Route path="/community" component={Community} />
      <Route path="/community/:id" component={CommunityPostDetail} />
      <Route path="/schedule" component={Schedule} />
      <Route path="/watchlist" component={Watchlist} />
      <Route path="/login" component={AuthPage} />
      <Route path="/register" component={AuthPage} />
      <Route path="/u/:username" component={ProfilePage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <ScrollToTop />
            <SidebarProvider>
              <Topbar />
              <Sidebar />
              <div className="pt-14">
                <Router />
              </div>
            </SidebarProvider>
          </WouterRouter>
        </AuthProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
