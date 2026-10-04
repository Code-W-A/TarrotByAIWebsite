import * as React from "react";
import { styled, createTheme, ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import MuiDrawer from "@mui/material/Drawer";
import Box from "@mui/material/Box";
import MuiAppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import List from "@mui/material/List";
import Typography from "@mui/material/Typography";
import Divider from "@mui/material/Divider";
import QueryBuilderIcon from "@mui/icons-material/QueryBuilder";
import IconButton from "@mui/material/IconButton";
import Badge from "@mui/material/Badge";
import FormatQuoteIcon from "@mui/icons-material/FormatQuote";
import Container from "@mui/material/Container";
import Filter2Icon from "@mui/icons-material/Filter2";
import Grid from "@mui/material/Grid";
import Paper from "@mui/material/Paper";
import Link from "@mui/material/Link";
import MenuIcon from "@mui/icons-material/Menu";
import LibraryBooksIcon from "@mui/icons-material/LibraryBooks";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import NotificationsIcon from "@mui/icons-material/Notifications";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import ListSubheader from "@mui/material/ListSubheader";
import StyleIcon from "@mui/icons-material/Style";
import DashboardIcon from "@mui/icons-material/Dashboard";
import ShoppingCartIcon from "@mui/icons-material/ShoppingCart";
import PeopleIcon from "@mui/icons-material/People";
import BarChartIcon from "@mui/icons-material/BarChart";
import LayersIcon from "@mui/icons-material/Layers";
import AssignmentIcon from "@mui/icons-material/Assignment";
import PaletteIcon from "@mui/icons-material/Palette";
import LogoutIcon from "@mui/icons-material/Logout";
import PeopleAltIcon from "@mui/icons-material/PeopleAlt";
import SettingsIcon from "@mui/icons-material/Settings";
import AdsClickIcon from "@mui/icons-material/AdsClick";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import VisibilityIcon from "@mui/icons-material/Visibility";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";

import { useRouter } from "next/router";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { handleSignOut } from "../../utils/signout";
import { Avatar } from "@mui/material";
import Image from "next/image";
import { useParams, useSearchParams } from "next/navigation";
import LocalPasswordGate, { clearDashboardAccess } from "./LocalPasswordGate";

const drawerWidth = 240;

const AppBar = styled(MuiAppBar, {
  shouldForwardProp: (prop) => prop !== "open",
})(({ theme, open }) => ({
  zIndex: theme.zIndex.drawer + 1,
  transition: theme.transitions.create(["width", "margin"], {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.leavingScreen,
  }),
  ...(open && {
    marginLeft: drawerWidth,
    width: `calc(100% - ${drawerWidth}px)`,
    transition: theme.transitions.create(["width", "margin"], {
      easing: theme.transitions.easing.sharp,
      duration: theme.transitions.duration.enteringScreen,
    }),
  }),
}));

const Drawer = styled(MuiDrawer, {
  shouldForwardProp: (prop) => prop !== "open",
})(({ theme, open }) => ({
  "& .MuiDrawer-paper": {
    position: "relative",
    whiteSpace: "nowrap",
    width: drawerWidth,
    transition: theme.transitions.create("width", {
      easing: theme.transitions.easing.sharp,
      duration: theme.transitions.duration.enteringScreen,
    }),
    boxSizing: "border-box",
    ...(!open && {
      overflowX: "hidden",
      transition: theme.transitions.create("width", {
        easing: theme.transitions.easing.sharp,
        duration: theme.transitions.duration.leavingScreen,
      }),
      width: theme.spacing(7),
      [theme.breakpoints.up("sm")]: {
        width: theme.spacing(9),
      },
    }),
  },
}));

// TODO remove, this demo shouldn't need to reset the theme.
const defaultTheme = createTheme();
const dashboardPrefetchScreens = [
  "notificari-manuale",
  "afirmatii-pozitive",
  "blog-articole",
  "citire-viitor-carti",
  "citire-viitor-categorii",
  "citire-personalizata-carti",
  "citire-personalizata-categorii",
  "citire-personalizata-variantecarti",
  "citate-motivationale",
  "courses",
  "ebooks",
  "videos",
  "culori-norocoase",
  "numere-norocoase",
  "ore-norocoase",
  "poza-api",
  "partner-promotions",
];

const administrarePrefetchScreens = [
  "abonati",
  "abonamente-duplicate",
  "user-tokens",
  "comentarii-video",
  "statistici-video",
  "analytics",
  "astrograme-pdf",
  "setari",
  "ads-orchestration",
];

const ADMIN_MENU_ITEMS = [
  { screen: "abonati", text: "Abonați Premium", Icon: PeopleAltIcon },
  { screen: "abonamente-duplicate", text: "Abonamente duplicate", Icon: ContentCopyIcon },
  { screen: "user-tokens", text: "Tokenuri push", Icon: NotificationsIcon },
  { screen: "comentarii-video", text: "Comentarii video", Icon: ChatBubbleOutlineIcon },
  { screen: "statistici-video", text: "Statistici video", Icon: VisibilityIcon },
  { screen: "analytics", text: "Firestore Analytics", Icon: BarChartIcon },
  { screen: "astrograme-pdf", text: "Astrograme PDF", Icon: PictureAsPdfIcon },
  { screen: "setari", text: "Setări", Icon: SettingsIcon },
  { screen: "ads-orchestration", text: "Orchestrare Ads", Icon: AdsClickIcon },
];

export default function CustomDrawer(props) {
  const basePath = props.basePath || "/dashboard";
  const variant = props.variant || "content";
  const shellTitle = variant === "admin" ? "Administrare" : "Dashboard";
  const [open, setOpen] = React.useState(true);
  const [selectedItem, setSelectedItem] = React.useState(
    props.selectedItem ? props.selectedItem : ""
  );
  const [drawerText, setDrawerText] = React.useState(
    props.selectedItem ? props.selectedItem : ""
  );
  const router = useRouter();
  const hasPrefetchedRef = React.useRef(false);

  React.useEffect(() => {
    if (!router.isReady || hasPrefetchedRef.current) return;
    hasPrefetchedRef.current = true;
    const screens =
      variant === "admin" ? administrarePrefetchScreens : dashboardPrefetchScreens;
    screens.forEach((screen) => {
      router.prefetch(`${basePath}/${screen}`);
    });
  }, [router.isReady, router, basePath, variant]);
  const toggleDrawer = () => {
    setOpen(!open);
  };

  const handleSelectedItem = (i) => {
    if (i.text === "Log out") {
      handleSignOut(router);
    } else if (i.citire) {
      setSelectedItem(i.citire);
      setDrawerText(i.text);
      router.push(`${basePath}/${i.screen}`);
    } else {
      setSelectedItem(i.text);
      setDrawerText(i.text);
      router.push(`${basePath}/${i.screen}`);
    }
  };

  const handleLogout = async () => {
    await clearDashboardAccess();
    router.replace(`${basePath}/login`);
  };

  // Firebase checks removed; access is handled by LocalPasswordGate

  return (
    <ThemeProvider theme={defaultTheme}>
      <Box sx={{ display: "flex", backgroundColor: "#303030" }}>
        <CssBaseline />
        <AppBar
          position="absolute"
          open={open}
          sx={{ backgroundColor: "#303030" }}
        >
          <Toolbar
            sx={{
              pr: "24px", // keep right padding when drawer closed
              backgroundColor: "#303030",
            }}
          >
            <IconButton
              edge="start"
              color="inherit"
              aria-label="open drawer"
              onClick={toggleDrawer}
              sx={{
                marginRight: "36px",
                ...(open && { display: "none" }),
              }}
            >
              <MenuIcon />
            </IconButton>
            <Typography
              component="h1"
              variant="h6"
              color="inherit"
              noWrap
              sx={{ flexGrow: 1, display: "flex", alignItems: "center" }}
            >
              {shellTitle}{" "}
              {selectedItem.length > 0 && (
                <>
                  <span style={{ display: "flex", alignItems: "center" }}>
                    <ChevronRightIcon />
                  </span>
                  <span style={{ display: "flex", alignItems: "center" }}>
                    {drawerText}
                  </span>
                </>
              )}
            </Typography>

            <img
              alt="Logo Cristina Zurba"
              src="/LogoPngTransparent.png"
              width={540}
              height={460}
              style={{ marginTop: 10, height: "4%", width: "4%" }}
            />
          </Toolbar>
        </AppBar>
        <Drawer variant="permanent" open={open} sx={{ backgroundColor: "red" }}>
          <Toolbar
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              px: [1],
              backgroundColor: "#303030",
            }}
          >
            <IconButton onClick={toggleDrawer} sx={{ color: "white" }}>
              <ChevronLeftIcon />
            </IconButton>
          </Toolbar>
          <Divider color={"#303030"} />
          <List
            component="nav"
            sx={{ backgroundColor: "#303030", height: "100%" }}
          >
            {variant === "admin" ? (
              <>
                {ADMIN_MENU_ITEMS.map((item) => (
                  <ListItemButton
                    key={item.screen}
                    onClick={() => handleSelectedItem(item)}
                  >
                    <ListItemIcon
                      sx={{
                        color: selectedItem === item.text ? "#ffc045" : "white",
                      }}
                    >
                      <item.Icon />
                    </ListItemIcon>
                    <ListItemText primary={item.text} sx={{ color: "white" }} />
                  </ListItemButton>
                ))}
                <Divider sx={{ my: 1 }} />
                <ListItemButton onClick={() => router.push("/dashboard")}>
                  <ListItemIcon sx={{ color: "white" }}>
                    <DashboardIcon />
                  </ListItemIcon>
                  <ListItemText primary="Dashboard conținut" sx={{ color: "white" }} />
                </ListItemButton>
                <ListItemButton onClick={handleLogout}>
                  <ListItemIcon sx={{ color: "white" }}>
                    <LogoutIcon />
                  </ListItemIcon>
                  <ListItemText primary="Log out" sx={{ color: "white" }} />
                </ListItemButton>
              </>
            ) : (
            <>
            <React.Fragment>
              {open && (
                <ListItemText
                  primary="Notificari manuale"
                  sx={{
                    color: "white",
                    marginLeft: "8%",
                  }}
                />
              )}
              <ListItemButton
                onClick={() =>
                  handleSelectedItem({
                    screen: "notificari-manuale",
                    text: "Notificari Manuale",
                  })
                }
              >
                <ListItemIcon
                  sx={{
                    color: selectedItem === "Notificari Manuale" ? "#ffc045" : "white",
                  }}
                >
                  <LibraryBooksIcon />
                </ListItemIcon>
                <ListItemText
                  primary="Notificari Manuale"
                  sx={{
                    color: "white",
                  }}
                />
              </ListItemButton>

              <Divider sx={{ my: 1 }} />
              {open && (
                <ListItemText
                  primary="Afirmatii pozitive"
                  sx={{
                    color: "white",
                    marginLeft: "8%",
                  }}
                />
              )}
              <ListItemButton
                onClick={() =>
                  handleSelectedItem({
                    screen: "afirmatii-pozitive",
                    text: "Afirmatii",
                  })
                }
              >
                <ListItemIcon
                  sx={{
                    color: selectedItem === "Afirmatii" ? "#ffc045" : "white",
                  }}
                >
                  <LibraryBooksIcon />
                </ListItemIcon>
                <ListItemText
                  primary="Afirmatii"
                  sx={{
                    color: "white",
                  }}
                />
              </ListItemButton>

              <Divider sx={{ my: 1 }} />
              {open && (
                <ListItemText
                  primary="Blog"
                  sx={{
                    color: "white",
                    marginLeft: "8%",
                  }}
                />
              )}
              <ListItemButton
                onClick={() =>
                  handleSelectedItem({
                    screen: "blog-articole",
                    text: "Articole",
                  })
                }
              >
                <ListItemIcon
                  sx={{
                    color: selectedItem === "Articole" ? "#ffc045" : "white",
                  }}
                >
                  <LibraryBooksIcon />
                </ListItemIcon>
                <ListItemText
                  primary="Articole"
                  sx={{
                    color: "white",
                  }}
                />
              </ListItemButton>

              <Divider sx={{ my: 1 }} />
              {open && (
                <ListItemText
                  primary="Citire de viitor"
                  sx={{
                    color: "white",
                    marginLeft: "8%",
                  }}
                />
              )}
              <ListItemButton
                onClick={() =>
                  handleSelectedItem({
                    screen: "citire-viitor-carti",
                    text: "Carti",
                  })
                }
              >
                <ListItemIcon
                  sx={{
                    color: selectedItem === "Carti" ? "#ffc045" : "white",
                  }}
                >
                  <StyleIcon />
                </ListItemIcon>
                <ListItemText
                  primary="Carti"
                  sx={{
                    color: "white",
                  }}
                />
              </ListItemButton>
              <ListItemButton
                onClick={() =>
                  handleSelectedItem({
                    screen: "citire-viitor-categorii",
                    text: "Categorii",
                  })
                }
              >
                <ListItemIcon
                  sx={{
                    color: selectedItem === "Categorii" ? "#ffc045" : "white",
                  }}
                >
                  <DashboardIcon />
                </ListItemIcon>
                <ListItemText
                  primary="Categorii"
                  sx={{
                    color: "white",
                  }}
                />
              </ListItemButton>
              <Divider sx={{ my: 1 }} />
              {open && (
                <ListItemText
                  primary="Citiri personalizate"
                  sx={{
                    color: "white",
                    marginLeft: "8%",
                  }}
                />
              )}
              <ListItemButton
                onClick={() =>
                  handleSelectedItem({
                    screen: "citire-personalizata-carti",
                    text: "Carti-Citiri-Personalizate",
                    citire: "Carti-Citiri-Personalizate",
                  })
                }
              >
                <ListItemIcon
                  sx={{
                    color:
                      selectedItem === "Carti-Citiri-Personalizate"
                        ? "#ffc045"
                        : "white",
                  }}
                >
                  <StyleIcon />
                </ListItemIcon>
                <ListItemText primary="Carti" sx={{ color: "white" }} />
              </ListItemButton>
              <ListItemButton
                onClick={() =>
                  handleSelectedItem({
                    screen: "citire-personalizata-categorii",
                    text: "Categorii-Citiri-Personalizate",
                    citire: "Categorii-Citiri-Personalizate",
                  })
                }
              >
                <ListItemIcon
                  sx={{
                    color:
                      selectedItem === "Categorii-Citiri-Personalizate"
                        ? "#ffc045"
                        : "white",
                  }}
                >
                  <DashboardIcon />
                </ListItemIcon>
                <ListItemText primary="Categorii" sx={{ color: "white" }} />
              </ListItemButton>
              <ListItemButton
                onClick={() =>
                  handleSelectedItem({
                    screen: "citire-personalizata-variantecarti",
                    text: "Variante de carti-Citiri-Personalizate",
                  })
                }
              >
                <ListItemIcon
                  sx={{
                    color:
                      selectedItem === "Variante de carti-Citiri-Personalizate"
                        ? "#ffc045"
                        : "white",
                  }}
                >
                  <LayersIcon />
                </ListItemIcon>
                <ListItemText
                  primary="Variante de carti"
                  sx={{ color: "white" }}
                />
              </ListItemButton>
              <Divider sx={{ my: 1 }} />
              {open && (
                <ListItemText
                  primary="Altele"
                  sx={{
                    color: "white",
                    marginLeft: "8%",
                  }}
                />
              )}
              <ListItemButton
                onClick={() =>
                  handleSelectedItem({
                    screen: "citate-motivationale",
                    text: "Citate Motivationale",
                  })
                }
              >
                <ListItemIcon
                  sx={{
                    color:
                      selectedItem === "Citate Motivationale"
                        ? "#ffc045"
                        : "white",
                  }}
                >
                  <FormatQuoteIcon />
                </ListItemIcon>
                <ListItemText
                  primary="Citate Motivationale"
                  sx={{ color: "white" }}
                />
              </ListItemButton>
              <ListItemButton
                onClick={() =>
                  handleSelectedItem({
                    screen: "videos",
                    text: "Videoclipuri",
                  })
                }
              >
                <ListItemIcon
                  sx={{
                    color: selectedItem === "Videoclipuri" ? "#ffc045" : "white",
                  }}
                >
                  <LibraryBooksIcon />
                </ListItemIcon>
                <ListItemText
                  primary="Videoclipuri"
                  sx={{ color: "white" }}
                />
              </ListItemButton>
              <ListItemButton
                onClick={() =>
                  handleSelectedItem({ screen: "ebooks", text: "Ebookuri" })
                }
              >
                <ListItemIcon
                  sx={{ color: selectedItem === "Ebookuri" ? "#ffc045" : "white" }}
                >
                  <LibraryBooksIcon />
                </ListItemIcon>
                <ListItemText primary="Ebookuri" sx={{ color: "white" }} />
              </ListItemButton>
              <ListItemButton
                onClick={() =>
                  handleSelectedItem({
                    screen: "courses",
                    text: "Cursuri video",
                  })
                }
              >
                <ListItemIcon
                  sx={{
                    color: selectedItem === "Cursuri video" ? "#ffc045" : "white",
                  }}
                >
                  <LibraryBooksIcon />
                </ListItemIcon>
                <ListItemText
                  primary="Cursuri video"
                  sx={{ color: "white" }}
                />
              </ListItemButton>
              <ListItemButton
                onClick={() =>
                  handleSelectedItem({
                    screen: "culori-norocoase",
                    text: "Culori Norocoase",
                  })
                }
              >
                <ListItemIcon
                  sx={{
                    color:
                      selectedItem === "Culori Norocoase" ? "#ffc045" : "white",
                  }}
                >
                  <PaletteIcon />
                </ListItemIcon>
                <ListItemText
                  primary="Culori Norocoase"
                  sx={{ color: "white" }}
                />
              </ListItemButton>
              <ListItemButton
                onClick={() =>
                  handleSelectedItem({
                    screen: "numere-norocoase",
                    text: "Numere norocoase",
                  })
                }
              >
                <ListItemIcon
                  sx={{
                    color:
                      selectedItem === "Numere norocoase" ? "#ffc045" : "white",
                  }}
                >
                  <Filter2Icon />
                </ListItemIcon>
                <ListItemText
                  primary="Numere norocoase"
                  sx={{ color: "white" }}
                />
              </ListItemButton>
              <ListItemButton
                onClick={() =>
                  handleSelectedItem({
                    screen: "ore-norocoase",
                    text: "Ore norocoase",
                  })
                }
              >
                <ListItemIcon
                  sx={{
                    color:
                      selectedItem === "Ore norocoase" ? "#ffc045" : "white",
                  }}
                >
                  <QueryBuilderIcon />
                </ListItemIcon>
                <ListItemText primary="Ore norocoase" sx={{ color: "white" }} />
              </ListItemButton>
              {/* <ListItemButton
                onClick={() =>
                  handleSelectedItem({
                    screen: "poza-api",
                    text: "Poza API Elai.io",
                  })
                }
              >
                <ListItemIcon
                  sx={{
                    color:
                      selectedItem === "Poza API Elai.io" ? "#ffc045" : "white",
                  }}
                >
                  <QueryBuilderIcon />
                </ListItemIcon>
                <ListItemText
                  primary="Poza API Elai.io"
                  sx={{ color: "white" }}
                />
              </ListItemButton> */}
            </React.Fragment>
            <Divider sx={{ my: 1 }} />
            <React.Fragment>
              <ListItemButton
                onClick={() =>
                  handleSelectedItem({
                    screen: "partner-promotions",
                    text: "Promovări parteneri",
                  })
                }
              >
                <ListItemIcon
                  sx={{
                    color: selectedItem === "Promovări parteneri" ? "#ffc045" : "white",
                  }}
                >
                  <ShoppingCartIcon />
                </ListItemIcon>
                <ListItemText primary="Promovări parteneri" sx={{ color: "white" }} />
              </ListItemButton>
              <ListItemButton onClick={() => router.push("/administrare")}>
                <ListItemIcon sx={{ color: "white" }}>
                  <SettingsIcon />
                </ListItemIcon>
                <ListItemText primary="Administrare" sx={{ color: "white" }} />
              </ListItemButton>
              <ListItemButton onClick={handleLogout}>
                <ListItemIcon
                  sx={{
                    color: "white",
                  }}
                >
                  <LogoutIcon />
                </ListItemIcon>
                <ListItemText primary="Log out" sx={{ color: "white" }} />
              </ListItemButton>
            </React.Fragment>
            </>
            )}
          </List>
        </Drawer>
        <Box
          component="main"
          sx={{
            backgroundColor: "#303030",
            flexGrow: 1,
            height: "100vh",
            overflow: "auto",
          }}
        >
          <Toolbar />
          {props.children}
        </Box>
      </Box>
    </ThemeProvider>
  );
}
