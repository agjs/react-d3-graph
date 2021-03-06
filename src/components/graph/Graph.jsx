/* eslint max-lines: "off" */
import React from "react";

import { drag as d3Drag } from "d3-drag";
import { forceLink as d3ForceLink } from "d3-force";
import { select as d3Select, selectAll as d3SelectAll, event as d3Event } from "d3-selection";
import { zoom as d3Zoom } from "d3-zoom";

import CONST from "./graph.const";
import DEFAULT_CONFIG from "./graph.config";
import ERRORS from "../../err";

import * as collapseHelper from "./collapse.helper";
import * as graphHelper from "./graph.helper";
import * as graphRenderer from "./graph.renderer";
import * as layoutHelper from "./graph.layout";
import utils from "../../utils";

Object.filter = (obj, predicate) =>
    Object.keys(obj)
        .filter(key => predicate(obj[key]))
        .reduce((res, key) => ((res[key] = obj[key]), res), {});

/**
 * Graph component is the main component for react-d3-graph components, its interface allows its user
 * to build the graph once the user provides the data, configuration (optional) and callback interactions (also optional).
 * The code for the [live example](https://danielcaldas.github.io/react-d3-graph/sandbox/index.html)
 * can be consulted [here](https://github.com/danielcaldas/react-d3-graph/blob/master/sandbox/Sandbox.jsx)
 * @example
 * import { Graph } from "react-d3-graph";
 *
 * // graph payload (with minimalist structure)
 * const data = {
 *     nodes: [
 *       {id: "Harry"},
 *       {id: "Sally"},
 *       {id: "Alice"}
 *     ],
 *     links: [
 *         {source: "Harry", target: "Sally"},
 *         {source: "Harry", target: "Alice"},
 *     ]
 * };
 *
 * // the graph configuration, you only need to pass down properties
 * // that you want to override, otherwise default ones will be used
 * const myConfig = {
 *     nodeHighlightBehavior: true,
 *     node: {
 *         color: "lightgreen",
 *         size: 120,
 *         highlightStrokeColor: "blue"
 *     },
 *     link: {
 *         highlightColor: "lightblue"
 *     }
 * };
 *
 * // graph event callbacks
 * const onClickGraph = function() {
 *      window.alert("Clicked the graph background");
 * };
 *
 * const onClickNode = function(nodeId) {
 *      window.alert("Clicked node ${nodeId}");
 * };
 *
 * const onRightClickNode = function(event, nodeId) {
 *      window.alert("Right clicked node ${nodeId}");
 * };
 *
 * const onMouseOverNode = function(nodeId) {
 *      window.alert(`Mouse over node ${nodeId}`);
 * };
 *
 * const onMouseOutNode = function(nodeId) {
 *      window.alert(`Mouse out node ${nodeId}`);
 * };
 *
 * const onClickLink = function(source, target) {
 *      window.alert(`Clicked link between ${source} and ${target}`);
 * };
 *
 * const onRightClickLink = function(event, source, target) {
 *      window.alert("Right clicked link between ${source} and ${target}");
 * };
 *
 * const onMouseOverLink = function(source, target) {
 *      window.alert(`Mouse over in link between ${source} and ${target}`);
 * };
 *
 * const onMouseOutLink = function(source, target) {
 *      window.alert(`Mouse out link between ${source} and ${target}`);
 * };
 *
 * <Graph
 *      id="graph-id" // id is mandatory, if no id is defined rd3g will throw an error
 *      data={data}
 *      config={myConfig}
 *      onClickGraph={onClickGraph}
 *      onClickNode={onClickNode}
 *      onRightClickNode={onRightClickNode}
 *      onClickLink={onClickLink}
 *      onRightClickLink={onRightClickLink}
 *      onMouseOverNode={onMouseOverNode}
 *      onMouseOutNode={onMouseOutNode}
 *      onMouseOverLink={onMouseOverLink}
 *      onMouseOutLink={onMouseOutLink}/>
 */
export default class Graph extends React.Component {
    /**
     * Obtain a set of properties which will be used to perform the focus and zoom animation if
     * required. In case there's not a focus and zoom animation in progress, it should reset the
     * transition duration to zero and clear transformation styles.
     * @returns {Object} - Focus and zoom animation properties.
     */
    _generateFocusAnimationProps = () => {
        const { focusedNodeId } = this.state;

        // In case an older animation was still not complete, clear previous timeout to ensure the new one is not cancelled
        if (this.state.enableFocusAnimation) {
            if (this.focusAnimationTimeout) {
                clearTimeout(this.focusAnimationTimeout);
            }

            this.focusAnimationTimeout = setTimeout(
                () => this.setState({ enableFocusAnimation: false }),
                this.state.config.focusAnimationDuration * 1000
            );
        }

        const transitionDuration = this.state.enableFocusAnimation ? this.state.config.focusAnimationDuration : 0;

        return {
            style: { transitionDuration: `${transitionDuration}s` },
            transform: focusedNodeId ? this.state.focusTransformation : null,
        };
    };

    /**
     * Sets d3 tick function and configures other d3 stuff such as forces
     * @returns {undefined}
     */
    _graphForcesConfig() {
        this.state.simulation
            .nodes(this.state.d3Nodes.concat(this.state.d3NodeLinks))
            //    .force("t",graphHelper.forceWeight().nodes(this.state.d3Nodes))
            .on("tick", this._tick)
            .on("end", this._simulationEnd);

        const forceLink = d3ForceLink(this.state.d3Links)
            .id(l => l.id)
            .distance(this.state.config.d3.linkLength)
            .strength(this.state.config.d3.linkStrength);

        this.state.simulation.force(CONST.LINK_CLASS_NAME, forceLink);

        if (this.props.config.d3 && !this.props.config.d3.showAllTicks) {
            this.state.simulation.stop();
            for (var i = 0; i < this.props.config.d3.ticks; ++i) this.state.simulation.tick();
            this._tock();
        }
    }

    /**
     * Configures other stuff like drag events
     * @returns {undefined}
     */
    _graphConfigFunctions() {
        const customNodeDrag = d3Drag()
            .on("start", this._onDragStart)
            .on("drag", this._onDragMove)
            .on("end", this._onDragEnd);

        d3Select(`#${this.state.id}-${CONST.GRAPH_WRAPPER_ID}`)
            .selectAll(".node")
            .call(customNodeDrag);
    }

    /**
     * Handles d3 drag "end" event.
     * @returns {undefined}
     */
    _onDragEnd = () => {
        if (
            !this.state.config.staticGraph &&
            this.state.config.automaticLayoutOn &&
            this.state.config.automaticRearrangeAfterDropNode
        ) {
            let nodes = this.state.nodes;

            // this is where d3 and react bind
            let selected = Object.keys(
                Object.filter(this.state.nodes, function(d) {
                    return d.selected;
                })
            );

            selected.forEach(function(idx) {
                if (nodes[idx].fx && nodes[idx].fy) {
                    Reflect.deleteProperty(nodes[idx], "fx");
                    Reflect.deleteProperty(nodes[idx], "fy");
                }
            });

            this.setState({
                d3ElementChange: false,
                nodeDragged: false,
            });
            this.state.config.nodeHighlightBehavior && this._setNodeHighlightedValue(this.state.highlightedNode, false);
            this.restartSimulationAlpha(this.state.config.d3.alphaTarget);
        }
    };

    /**
     * Handles d3 "drag" event.
     * {@link https://github.com/d3/d3-drag/blob/master/README.md#drag_subject|more about d3 drag}
     * node contains all information that was previously fed by rd3g.
     * @returns {undefined}
     */
    _onDragMove = () => {
        // peviously used index and nodeList parameter const id = nodeList[index].id;
        let nodes = this.state.nodes;
        let d3nodes = this.state.d3Nodes;

        if (!this.state.config.staticGraph) {
            // this is where d3 and react bind
            let selected = Object.keys(
                Object.filter(this.state.nodes, function(d) {
                    return d.selected;
                })
            );

            selected.forEach(function(idx) {
                const d3Node = d3nodes.find(d => {
                    return idx == d.id;
                });

                d3Node.x += d3Event.dx;
                d3Node.y += d3Event.dy;

                nodes[idx].x = d3Node.x;
                nodes[idx].y = d3Node.y;

                nodes[idx]["fx"] = d3Node.x;
                nodes[idx]["fy"] = d3Node.y;
            });

            this._tock();
        }
    };

    /**
     * Handles d3 drag "start" event.
     * @param  {Object} ev - if not undefined it will contain event data.
     * @param  {number} index - index of the node that is being dragged.
     * @param  {Array.<Object>} nodeList - array of d3 nodes. This list of nodes is provided by d3, each
     * node contains all information that was previously fed by rd3g.
     * @returns {undefined}
     */
    _onDragStart = (ev, index, nodeList) => {
        const id = nodeList[index].id;
        let nodes = this.state.nodes;

        this.pauseSimulation();
        if (!nodes[id]["selected"] && !(d3Event.sourceEvent.shiftKey || d3Event.sourceEvent.metaKey)) {
            Object.keys(nodes).forEach(key => {
                nodes[key].selected = nodes[key].previouslySelected = false;
            });
            nodes[id]["selected"] = !nodes[id]["previouslySelected"];
        }
        this.setState({
            nodes: nodes,
            d3ElementChange: true,
            nodeDragged: true,
        });

        if (this.state.enableFocusAnimation) {
            this.setState({ enableFocusAnimation: false });
        }
    };

    /**
     * Sets nodes and links highlighted value.
     * @param  {string} id - the id of the node to highlight.
     * @param  {boolean} [value=false] - the highlight value to be set (true or false).
     * @returns {undefined}
     */
    _setNodeHighlightedValue = (id, value = false) => {
        this._tock(
            graphHelper.updateNodeHighlightedValue(this.state.nodes, this.state.links, this.state.config, id, value)
        );
    };

    /**
     * The tick function simply calls React set state in order to update component and render nodes
     * along time as d3 calculates new node positioning.
     * @param {Object} state - new state to pass on.
     * @param {Function} [cb] - optional callback to fed in to {@link setState()|https://reactjs.org/docs/react-component.html#setstate}.
     * @returns {undefined}
     */
    _tick = (state = {}, cb) => {
        // d3Select(`#${this.state.id}-${CONST.GRAPH_WRAPPER_ID}`)
        //     .selectAll(".line")
        //     .attr("x1", function(d) {
        //         return d.source.x;
        //     })
        //     .attr("y1", function(d) { return d.source.y; })
        //     .attr("x2", function(d) { return d.target.x; })
        //     .attr("y2", function(d) { return d.target.y; });
        //
        // d3Select(`#${this.state.id}-${CONST.GRAPH_WRAPPER_ID}`)
        //     .selectAll(".node")
        //     .attr("cx", function(d) { return d.x; })
        //     .attr("cy", function(d) { return d.y; });

        // linkNode.attr("cx", function(d) { return d.x = (d.source.x + d.target.x) * 0.5; })
        //     .attr("cy", function(d) { return d.y = (d.source.y + d.target.y) * 0.5; });

        this._tock(state, cb);
    };

    /**
     * The tick function simply calls React set state in order to update component and render nodes
     * along time as d3 calculates new node positioning.
     * @param {Object} state - new state to pass on.
     * @param {Function} [cb] - optional callback to fed in to {@link setState()|https://reactjs.org/docs/react-component.html#setstate}.
     * @returns {undefined}
     */
    _tock = (state = {}, cb) => {
        if (
            !this.state.newGraphElements &&
            !this.state.d3ConfigUpdated &&
            !this.state.configUpdated &&
            !this.state.d3ElementChange &&
            this.state.simulation.alpha() < this.state.simulation.alphaMin()
        ) {
            return;
        }
        cb ? this.setState(state, cb) : this.setState(state);
    };

    /**
     * called when simulation ends
     * @returns {undefined}
     */
    _simulationEnd = () => {
        this.forceUpdate();
    };

    /**
     * Configures zoom upon graph with default or user provided values.<br/>
     * {@link https://github.com/d3/d3-zoom#zoom}
     * @returns {undefined}
     */
    _zoomConfig = () =>
        d3Select(`#${this.state.id}-${CONST.GRAPH_WRAPPER_ID}`).call(
            d3Zoom()
                .scaleExtent([this.state.config.minZoom, this.state.config.maxZoom])
                .on("zoom", this._zoomed)
        );

    /**
     * Handler for "zoom" event within zoom config.
     * @returns {Object} returns the transformed elements within the svg graph area.
     */
    _zoomed = () => {
        const transform = d3Event.transform;

        d3SelectAll(`#${this.state.id}-${CONST.GRAPH_CONTAINER_ID}`).attr("transform", transform);

        this.state.config.panAndZoom && this.setState({ transform: transform.k });
    };

    /**
     * Calls the callback passed to the component.
     * @param  {Object} e - The event of onClick handler.
     * @returns {undefined}
     */
    onClickGraph = e => {
        if (this.state.enableFocusAnimation) {
            this.setState({ enableFocusAnimation: false });
        }

        // Only trigger the graph onClickHandler, if not clicked a node or link.
        // toUpperCase() is added as a precaution, as the documentation says tagName should always
        // return in UPPERCASE, but chrome returns lowercase
        if (
            e.target.tagName.toUpperCase() === "SVG" &&
            e.target.attributes.name.value === `svg-container-${this.state.id}`
        ) {
            this.props.onClickGraph && this.props.onClickGraph();
        }
    };

    /**
     * Collapses the nodes, then calls the callback passed to the component.
     * @param  {Object} e - d3 event Object.
     * @param  {string} clickedNodeId - The id of the node where the click was performed.
     * @returns {undefined}
     */
    onClickNode = (e, clickedNodeId) => {
        let nodes = this.state.nodes;
        let d3links = this.state.d3Links;

        //unselect all the links
        Object.keys(d3links).forEach(key => {
            d3links[key].selected = d3links[key].previouslySelected = false;
        });

        if (e.shiftKey || e.metaKey) {
            const node = Object.assign({}, nodes[clickedNodeId], {
                selected: !nodes[clickedNodeId]["previouslySelected"],
                previouslySelected: !nodes[clickedNodeId]["previouslySelected"],
            });

            let updatedNodes = Object.assign({}, nodes, { [clickedNodeId]: node });

            this.setState({
                nodes: updatedNodes,
            });

            let selected = Object.keys(
                Object.filter(updatedNodes, function(d) {
                    return d.selected;
                })
            );

            this.props.onClickNode && this.props.onClickNode(selected);
        } else {
            const reset = nodes[clickedNodeId]["previouslySelected"] ? false : true;

            Object.keys(nodes).forEach(key => {
                nodes[key].selected = nodes[key].previouslySelected = false;
            });

            nodes[clickedNodeId]["selected"] = reset;
            nodes[clickedNodeId]["previouslySelected"] = reset;

            if (this.state.config.collapsible) {
                this.setState({
                    d3ElementChange: true,
                    nodes: nodes,
                });

                const leafConnections = collapseHelper.getTargetLeafConnections(
                    clickedNodeId,
                    this.state.links,
                    this.state.config
                );
                const links = collapseHelper.toggleLinksMatrixConnections(
                    this.state.links,
                    leafConnections,
                    this.state.config
                );
                const d3Links = collapseHelper.toggleLinksConnections(this.state.d3Links, links);

                this._tock(
                    {
                        links,
                        d3Links,
                    },
                    () => this.props.onClickNode && this.props.onClickNode(clickedNodeId)
                );
            } else {
                this.setState({
                    d3ElementChange: true,
                    nodes: nodes,
                    d3Links: d3links,
                });
                if (reset) {
                    this.props.onClickNode && this.props.onClickNode(clickedNodeId);
                }
            }
        }
    };

    /**
     * Change the selection color of the links
     * NOTE: only support single selection
     * @param  {string} source - The id of the source node where the click was performed.
     * @param {string} target - the id of the target of this link clicked
     * @returns {undefined}
     */
    onClickLink = (source, target) => {
        let nodes = this.state.nodes;
        let d3links = this.state.d3Links;

        //unselect all nodes
        Object.keys(nodes).forEach(key => {
            nodes[key].selected = nodes[key].previouslySelected = false;
        });
        Object.keys(d3links).forEach(key => {
            const sel = d3links[key].source.id.toString() === source && d3links[key].target.id.toString() === target;

            d3links[key].selected = d3links[key].previouslySelected = sel;
        });

        this.setState({
            d3ElementChange: true,
            nodes: nodes,
            d3Links: d3links,
        });

        this.props.onClickLink && this.props.onClickLink(source, target);
    };

    /**
     * Handles mouse over node event.
     * @param  {string} id - id of the node that participates in the event.
     * @returns {undefined}
     */
    onMouseOverNode = id => {
        this.props.onMouseOverNode && this.props.onMouseOverNode(id);
        this.state.config.nodeHighlightBehavior && this._setNodeHighlightedValue(id, true);
    };

    /**
     * Handles mouse out node event.
     * @param  {string} id - id of the node that participates in the event.
     * @returns {undefined}
     */
    onMouseOutNode = id => {
        this.props.onMouseOutNode && this.props.onMouseOutNode(id);
        this.state.config.nodeHighlightBehavior && this._setNodeHighlightedValue(id, false);
    };

    /**
     * Handles mouse over link event.
     * @param  {string} source - id of the source node that participates in the event.
     * @param  {string} target - id of the target node that participates in the event.
     * @returns {undefined}
     */
    onMouseOverLink = (source, target) => {
        this.props.onMouseOverLink && this.props.onMouseOverLink(source, target);

        if (this.state.config.linkHighlightBehavior) {
            this.setState({ d3ElementChange: true });
            this.state.highlightedLink = { source, target };
            this._tock();
        }
    };

    /**
     * Handles mouse out link event.
     * @param  {string} source - id of the source node that participates in the event.
     * @param  {string} target - id of the target node that participates in the event.
     * @returns {undefined}
     */
    onMouseOutLink = (source, target) => {
        this.props.onMouseOutLink && this.props.onMouseOutLink(source, target);

        if (this.state.config.linkHighlightBehavior) {
            this.setState({ d3ElementChange: true });
            this.state.highlightedLink = undefined;

            this._tock();
        }
    };

    /**
     * Calls d3 simulation.stop().<br/>
     * {@link https://github.com/d3/d3-force#simulation_stop}
     * @returns {undefined}
     */
    pauseSimulation = () => {
        this.state.simulation.stop();
    };

    /**
     * This method resets all nodes fixed positions by deleting the properties fx (fixed x)
     * and fy (fixed y). Following this, a simulation is triggered in order to force nodes to go back
     * to their original positions (or at least new positions according to the d3 force parameters).
     * @returns {undefined}
     */
    resetNodesPositions = () => {
        if (!this.state.config.staticGraph) {
            for (let nodeId in this.state.nodes) {
                let node = this.state.nodes[nodeId];

                if (node.fx && node.fy) {
                    Reflect.deleteProperty(node, "fx");
                    Reflect.deleteProperty(node, "fy");
                }
            }

            //this.state.simulation.alphaTarget(this.state.config.d3.alphaTarget).restart();
            this.restartSimulationAlpha(this.state.config.d3.alphaTarget);
            this._tock();
        }
    };

    /**
     * Calls d3 simulation.restart().<br/>
     * {@link https://github.com/d3/d3-force#simulation_restart}
     * @returns {undefined}
     */
    restartSimulation = () => {
        !this.state.config.staticGraph && this.state.simulation.restart();
    };

    /**
     * Calls d3 simulation.alphaTarget(alpha).restart().<br/>
     * {@link https://github.com/d3/d3-force#simulation_restart}
     * @param {number} alpha the new alpha value
     * @returns {undefined}
     */
    restartSimulationAlpha = alpha => {
        this.state.simulation.alphaTarget(alpha).restart();
    };

    constructor(props) {
        super(props);

        if (!this.props.id) {
            utils.throwErr(this.constructor.name, ERRORS.GRAPH_NO_ID_PROP);
        }

        this.focusAnimationTimeout = null;
        this.state = graphHelper.initializeGraphState(this.props, this.state);
    }

    /**
     * @deprecated
     * `componentWillReceiveProps` has a replacement method in react v16.3 onwards.
     * that is getDerivedStateFromProps.
     * But one needs to be aware that if an anti pattern of `componentWillReceiveProps` is
     * in place for this implementation the migration might not be that easy.
     * See {@link https://reactjs.org/blog/2018/06/07/you-probably-dont-need-derived-state.html}.
     * @param {Object} nextProps - props.
     * @returns {undefined}
     */
    componentWillReceiveProps(nextProps) {
        const { graphElementsUpdated, newGraphElements } = graphHelper.checkForGraphElementsChanges(
            nextProps,
            this.state
        );

        const state = graphElementsUpdated ? graphHelper.initializeGraphState(nextProps, this.state) : this.state;

        const newConfig = nextProps.config || {};
        const { configUpdated, d3ConfigUpdated } = graphHelper.checkForGraphConfigChanges(nextProps, this.state);
        const config = configUpdated ? utils.merge(DEFAULT_CONFIG, newConfig) : this.state.config;

        // in order to properly update graph data we need to pause eventual d3 ongoing animations
        newGraphElements && this.pauseSimulation();

        const transform = newConfig.panAndZoom !== this.state.config.panAndZoom ? 1 : this.state.transform;

        const focusedNodeId = nextProps.data.focusedNodeId;
        const d3FocusedNode = this.state.d3Nodes.find(node => `${node.id}` === `${focusedNodeId}`);
        const focusTransformation = graphHelper.getCenterAndZoomTransformation(d3FocusedNode, this.state.config);
        const enableFocusAnimation = this.props.data.focusedNodeId !== nextProps.data.focusedNodeId;

        this.setState({
            ...state,
            config,
            configUpdated,
            d3ConfigUpdated,
            newGraphElements,
            transform,
            focusedNodeId,
            enableFocusAnimation,
            focusTransformation,
        });
    }

    componentDidUpdate(prevProps, prevState) {
        if (prevState !== this.state) {
            if (this.state.newGraphElements || this.state.d3ConfigUpdated) {
                if (!this.state.config.staticGraph && this.state.config.automaticLayoutOn) {
                    this._graphForcesConfig();
                    this.restartSimulation();
                }

                this._graphConfigFunctions();

                this.setState({ newGraphElements: false, d3ConfigUpdated: false, d3ElementChange: false });
            }

            if (this.state.configUpdated) {
                // if the property staticGraph was activated we want to stop possible ongoing simulation
                if (this.state.config.staticGraph) {
                    this.pauseSimulation();
                }

                this._zoomConfig();
                this.setState({ configUpdated: false, d3ElementChange: false });
            }
        }
    }

    componentDidMount() {
        if (!this.state.config.staticGraph) {
            this._graphForcesConfig();
        }
        //setup drag and drop
        this._graphConfigFunctions();

        // graph zoom and drag&drop all network
        this._zoomConfig();
    }

    componentWillUnmount() {
        this.pauseSimulation();
    }

    render() {
        let alpha = this.state.simulation.alpha();
        const { nodes, links, defs, nodeLinks } = graphRenderer.renderGraph(
            this.state.nodes,
            this.state.d3Nodes,
            {
                onClickNode: this.onClickNode,
                onRightClickNode: this.props.onRightClickNode,
                onMouseOverNode: this.onMouseOverNode,
                onMouseOut: this.onMouseOutNode,
            },
            this.state.d3Links,
            this.state.links,
            {
                onClickLink: this.onClickLink,
                onRightClickLink: this.props.onRightClickLink,
                onMouseOverLink: this.onMouseOverLink,
                onMouseOutLink: this.onMouseOutLink,
                layoutCallback: layoutHelper.layoutCallbackHelper(this.state.config.d3.layoutMode),
            },
            this.state.d3NodeLinks,
            this.state.config,
            this.state.highlightedNode,
            this.state.highlightedLink,
            this.state.transform,
            this.state.nodeDragged,
            alpha
        );

        const svgStyle = {
            height: this.state.config.height,
            width: this.state.config.width,
        };

        //console.log("nodes in render ", nodes);
        //console.log("links in render ", links);
        const containerProps = this._generateFocusAnimationProps();

        return (
            <div id={`${this.state.id}-${CONST.GRAPH_WRAPPER_ID}`}>
                <svg name={`svg-container-${this.state.id}`} style={svgStyle} onClick={this.onClickGraph}>
                    {defs}
                    <g id={`${this.state.id}-${CONST.GRAPH_CONTAINER_ID}`} {...containerProps}>
                        {nodeLinks}
                        {links}
                        {nodes}
                    </g>
                </svg>
            </div>
        );
    }
}
