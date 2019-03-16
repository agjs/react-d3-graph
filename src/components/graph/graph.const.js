import CONST from "../../const";

export default {
    COORDS_SEPARATOR: ",",
    FORCE_X: 0.06,
    FORCE_Y: 0.06,
    RADIUS_COLLIDE: 10,
    GRAPH_CONTAINER_ID: "graph-container-zoomable",
    GRAPH_WRAPPER_ID: "graph-wrapper",
    KEYWORDS: {
        SAME: "SAME",
    },
    LINK_CLASS_NAME: "link",
    NODE_CLASS_NAME: "node",
    LAYOUT_MODES: {
        FREEFORM: "freeform",
        WEAKTREE: "weaktree",
        WEAKFLOW: "weakflow",
    },
    ...CONST,
};
