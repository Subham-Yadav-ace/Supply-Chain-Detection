import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import './DependencyTree.css';

function DependencyTree({ tree, results, onNodeClick }) {
  const svgRef = useRef(null);
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  useEffect(() => {
    if (containerRef.current) {
      const { width, height } = containerRef.current.getBoundingClientRect();
      setDimensions({ width, height: Math.max(height, 500) });
    }
  }, []);

  useEffect(() => {
    if (!tree || tree.length === 0 || !svgRef.current) return;

    // Create lookup map for results
    const resultMap = new Map();
    results.forEach(r => resultMap.set(r.name, r));

    // Construct nodes
    const nodesMap = new Map();
    
    // Add unique packages as nodes
    tree.forEach(entry => {
      if (!nodesMap.has(entry.name)) {
        const res = resultMap.get(entry.name);
        nodesMap.set(entry.name, {
          id: entry.name,
          version: entry.version,
          depth: entry.depth,
          score: res?.riskScore ?? -2, // -2 = scanning
          result: res,
          radius: entry.depth === 0 ? 30 : Math.max(10, 20 - (entry.depth * 2))
        });
      }
    });

    const nodes = Array.from(nodesMap.values());

    // Construct links
    const links = [];
    tree.forEach(entry => {
      if (entry.parent && nodesMap.has(entry.parent) && nodesMap.has(entry.name)) {
        links.push({
          source: entry.parent,
          target: entry.name,
          value: entry.depth
        });
      }
    });

    // Clear previous SVG content
    d3.select(svgRef.current).selectAll("*").remove();

    const svg = d3.select(svgRef.current)
      .attr('width', dimensions.width)
      .attr('height', dimensions.height)
      .attr('viewBox', [0, 0, dimensions.width, dimensions.height]);

    // Add zoom behavior
    const zoom = d3.zoom()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });
    svg.call(zoom);

    const g = svg.append('g');

    // Define simulation
    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id(d => d.id).distance(100))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(dimensions.width / 2, dimensions.height / 2))
      .force('collide', d3.forceCollide().radius(d => d.radius + 10));

    // Draw links
    const link = g.append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke', 'rgba(255,255,255,0.2)')
      .attr('stroke-width', d => Math.max(1, 4 - d.value));

    // Define color scale
    const getColor = (score) => {
      if (score === -1) return '#9e9e9e'; // Error
      if (score === -2) return '#6272a4'; // Scanning
      if (score >= 76) return '#ef5350';  // Critical
      if (score >= 51) return '#ff9800';  // High
      if (score >= 26) return '#ffeb3b';  // Medium
      return '#4caf50';                   // Low
    };

    // Draw nodes
    const node = g.append('g')
      .attr('class', 'nodes')
      .selectAll('g')
      .data(nodes)
      .join('g')
      .attr('cursor', 'pointer')
      .on('click', (event, d) => {
        if (d.result && onNodeClick) onNodeClick(d.result);
      })
      .call(d3.drag()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        }));

    // Add pulse ring for high/critical risks
    node.append('circle')
      .attr('class', d => d.score >= 51 ? 'pulse-ring' : '')
      .attr('r', d => d.radius + 5)
      .attr('fill', 'none')
      .attr('stroke', d => getColor(d.score))
      .attr('stroke-width', 2);

    // Node circle
    node.append('circle')
      .attr('r', d => d.radius)
      .attr('fill', d => getColor(d.score))
      .attr('stroke', '#1f2833')
      .attr('stroke-width', 2);

    // Node labels
    node.append('text')
      .text(d => d.id)
      .attr('x', d => d.radius + 8)
      .attr('y', 4)
      .attr('fill', '#fff')
      .attr('font-size', '12px')
      .attr('pointer-events', 'none');

    // Tick function
    simulation.on('tick', () => {
      link
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y);

      node
        .attr('transform', d => `translate(${d.x},${d.y})`);
    });

    return () => {
      simulation.stop();
    };
  }, [tree, results, dimensions, onNodeClick]);

  return (
    <div className="tree-container" ref={containerRef}>
      <svg ref={svgRef}></svg>
    </div>
  );
}

export default DependencyTree;
