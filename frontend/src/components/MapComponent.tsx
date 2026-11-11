/* eslint-disable  @typescript-eslint/no-explicit-any */
import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {GeoJSON, LayersControl, MapContainer, TileLayer, useMap, ZoomControl} from "react-leaflet";
import L from "leaflet";
import 'leaflet/dist/leaflet.css';
import 'leaflet.fullscreen/Control.FullScreen.css';
import 'leaflet.fullscreen';
import '@geoman-io/leaflet-geoman-free';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import './scss/MapComponent.scss';
import type { DrawnGeometry } from '../services/util/FeatureForm.ts';


interface GeoJSONFeature {
  type: "Feature";
  geometry: {
    type: "Point" | "Polygon" | "LineString";
    coordinates: number[] | number[][] | number[][][];
  };
  properties: NonNullable<unknown>;
}
interface GeoJSONCollection {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
}

export interface SidebarPanelContent {
  title: string;
  body: React.ReactNode;
  onClose: () => void;
}

export interface DrawHandlers {
  onCreated: (id: string, geometry: DrawnGeometry) => void;
  onChanged: (id: string, geometry: DrawnGeometry) => void;
  onRemoved: (id: string) => void;
  onSelected: (id: string) => void;
}

interface MapComponentProps {
  geoJsonData?: {
    type: "FeatureCollection";
    features: GeoJSONFeature[];
  };
  /** Enables the Leaflet-Geoman drawing toolbar. */
  drawingEnabled?: boolean;
  /** Changing this key discards all drawn layers (start of a new collection). */
  drawingSessionKey?: number;
  /** Geometries that are put on the map as editable layers when drawing starts (e.g. uploaded data). */
  drawingInitial?: Array<{ id: string; geometry: DrawnGeometry }>;
  drawHandlers?: DrawHandlers;
  /** Replaces the feature-detail sidebar, e.g. with an attribute table. */
  editorPanel?: SidebarPanelContent | null;
}
// Fullscreen control component
const FullscreenControl: React.FC = () => {
  const map = useMap();
  useEffect(() => {
    const fullscreenControl = L.control.fullscreen({ position: "topleft" });
    fullscreenControl.addTo(map);
    // keep it the first control of the corner, so the drawing toolbar shares its row
    const container = fullscreenControl.getContainer();
    container.parentElement.prepend(container);
    return () => {
      fullscreenControl.remove();
    };
  }, [map]);

  return null;
};

// Keeps the map from reacting to clicks, scrolling and key presses made inside the sidebar overlay
const stopMapEvents = (el: HTMLElement) => {
  L.DomEvent.disableClickPropagation(el);
  L.DomEvent.disableScrollPropagation(el);
  L.DomEvent.on(el, 'keydown keyup keypress', L.DomEvent.stopPropagation);
};

const SidebarPanelBody: React.FC<{ panel: SidebarPanelContent }> = ({ panel }) => (
  <>
    <div className="map-sidebar__header">
      <h3>{panel.title}</h3>
      <button
        className="map-sidebar__close"
        onClick={panel.onClose}
        aria-label="Schließen"
      >
        ×
      </button>
    </div>
    <div className="map-sidebar__content">{panel.body}</div>
  </>
);

// Sidebar that is rendered inside the map container via portal when in fullscreen
const FullscreenSidebar: React.FC<{ panel: SidebarPanelContent | null }> = ({ panel }) => {
  const map = useMap();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const portalContainer = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Create a dedicated container inside the map DOM for the portal
    const container = document.createElement('div');
    container.className = 'fullscreen-sidebar-portal';
    stopMapEvents(container);
    map.getContainer().appendChild(container);
    portalContainer.current = container;

    const onEnter = () => setIsFullscreen(true);
    const onExit = () => setIsFullscreen(false);
    map.on('enterFullscreen', onEnter);
    map.on('exitFullscreen', onExit);

    return () => {
      map.off('enterFullscreen', onEnter);
      map.off('exitFullscreen', onExit);
      container.remove();
    };
  }, [map]);

  if (!isFullscreen || !panel || !portalContainer.current) return null;

  return createPortal(
    <div className="map-sidebar map-sidebar--open map-sidebar--fullscreen">
      <SidebarPanelBody panel={panel} />
    </div>,
    portalContainer.current
  );
};

// The sidebar resizes the map container, so Leaflet has to be told to recalculate its size
const MapResizeObserver: React.FC = () => {
  const map = useMap();
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
};

// Approximates a circle (centre + radius in metres) as a polygon, since GeoJSON has no circle geometry
function circleToPolygon(circle: L.Circle, steps = 64): DrawnGeometry {
  const { lat, lng } = circle.getLatLng();
  const angular = circle.getRadius() / 6371008.8;
  const toRad = Math.PI / 180;
  const ring: number[][] = [];
  for (let i = 0; i < steps; i++) {
    const bearing = (2 * Math.PI * i) / steps;
    const lat2 = Math.asin(
      Math.sin(lat * toRad) * Math.cos(angular) + Math.cos(lat * toRad) * Math.sin(angular) * Math.cos(bearing)
    );
    const lng2 = lng * toRad + Math.atan2(
      Math.sin(bearing) * Math.sin(angular) * Math.cos(lat * toRad),
      Math.cos(angular) - Math.sin(lat * toRad) * Math.sin(lat2)
    );
    ring.push([lng2 / toRad, lat2 / toRad]);
  }
  ring.push(ring[0]);
  return { type: "Polygon", coordinates: [ring] };
}

// Unique across effect re-runs, so ids of re-created layers never collide
let layerCounter = 0;

// Leaflet-Geoman toolbar for drawing/editing/removing the geometries of a new location collection
const DrawManager: React.FC<{
  enabled: boolean;
  sessionKey: number;
  initial?: Array<{ id: string; geometry: DrawnGeometry }>;
  handlers?: DrawHandlers;
}> = ({ enabled, sessionKey, initial, handlers }) => {
  const map = useMap();
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const initialRef = useRef(initial);
  initialRef.current = initial;

  useEffect(() => {
    if (!enabled) return;
    const layers = new Map<string, L.Layer>();
    const idOf = (layer: any): string | undefined => layer?._plmId;
    const geometryOf = (layer: any): DrawnGeometry =>
      layer instanceof L.Circle ? circleToPolygon(layer) : layer.toGeoJSON().geometry;

    map.pm.setGlobalOptions({ continueDrawing: false, allowSelfIntersection: false });
    map.pm.addControls({
      position: 'topleft',
      oneBlock: true,
      drawMarker: true,
      drawCircleMarker: true,
      drawPolyline: true,
      drawRectangle: true,
      drawPolygon: true,
      drawCircle: true,
      drawText: true,
      editMode: true,
      dragMode: true,
      cutPolygon: true,
      rotateMode: true,
      removalMode: true,
    });

    // Tracks a layer as a feature of the collection and wires its edit/select events
    const register = (layer: any, id: string) => {
      layer._plmId = id;
      layers.set(id, layer);
      const notifyChange = () => handlersRef.current?.onChanged(id, geometryOf(layer));
      layer.on('pm:edit', notifyChange);
      layer.on('pm:dragend', notifyChange);
      layer.on('pm:rotateend', notifyChange);
      layer.on('click', () => {
        if (!map.pm.globalDrawModeEnabled() && !map.pm.globalRemovalModeEnabled()) {
          handlersRef.current?.onSelected(id);
        }
      });
    };
    const nextId = () => `drawn-${sessionKey}-${++layerCounter}`;

    // Existing geometries are shown as regular layers, so they can be selected, edited and dragged like drawn ones
    (initialRef.current ?? []).forEach(({ id, geometry }) => {
      L.geoJSON({ type: "Feature", geometry, properties: {} } as any).getLayers().forEach(layer => {
        layer.addTo(map);
        register(layer, id);
      });
    });

    const onCreate = (e: any) => {
      const id = nextId();
      register(e.layer, id);
      handlersRef.current?.onCreated(id, geometryOf(e.layer));
    };

    const onRemove = (e: any) => {
      const id = idOf(e.layer);
      if (!id) return;
      layers.delete(id);
      handlersRef.current?.onRemoved(id);
    };

    // Cutting replaces the original layer; the first resulting part keeps the original's attributes
    const onCut = (e: any) => {
      const originalId = idOf(e.originalLayer);
      const parts: any[] = e.layer instanceof L.LayerGroup ? e.layer.getLayers() : [e.layer];
      if (originalId) layers.delete(originalId);
      parts.forEach((part, index) => {
        if (index === 0 && originalId) {
          register(part, originalId);
          handlersRef.current?.onChanged(originalId, geometryOf(part));
        } else {
          const id = nextId();
          register(part, id);
          handlersRef.current?.onCreated(id, geometryOf(part));
        }
      });
      if (parts.length === 0 && originalId) handlersRef.current?.onRemoved(originalId);
    };

    map.on('pm:create', onCreate);
    map.on('pm:remove', onRemove);
    map.on('pm:cut', onCut);

    return () => {
      map.off('pm:create', onCreate);
      map.off('pm:remove', onRemove);
      map.off('pm:cut', onCut);
      map.pm.disableDraw();
      map.pm.disableGlobalEditMode();
      map.pm.disableGlobalDragMode();
      map.pm.disableGlobalCutMode();
      map.pm.disableGlobalRotateMode();
      map.pm.disableGlobalRemovalMode();
      map.pm.removeControls();
      layers.forEach(layer => layer.remove());
    };
  }, [map, enabled, sessionKey]);

  return null;
};

/**
 * Checks if the given coordinates array contains any NaN values.
 * @param coordinates - The coordinates to check.
 * @returns true if any NaN is found, false otherwise.
 */
function hasInvalidCoordinates(coordinates: number[] | number[][] | number[][][]): boolean {
  if (Array.isArray(coordinates)) {
    return coordinates.some((coord) =>
      Array.isArray(coord) ? hasInvalidCoordinates(coord) : isNaN(coord)
    );
  }
  return false;
}

/**
 * Filters the features array to remove those with invalid coordinates.
 * @param features - Array of GeoJSON features.
 * @returns A new array containing only valid features.
 */
function filterValidFeatures(features: GeoJSONFeature[]): GeoJSONFeature[] {
  return features.filter((feature) => !hasInvalidCoordinates(feature.geometry.coordinates));
}

const MapComponent: React.FC<MapComponentProps> = ({
  geoJsonData,
  drawingEnabled = false,
  drawingSessionKey = 0,
  drawingInitial,
  drawHandlers,
  editorPanel = null,
}) => {
  const [selectedFeature, setSelectedFeature] = useState<GeoJSONFeature | null>(null);

  useEffect(()=>{
    setSelectedFeature(null)
  },[geoJsonData])

  const validGeoJsonData: GeoJSONCollection = geoJsonData && geoJsonData.features ? {
    type: "FeatureCollection",
    features: filterValidFeatures(geoJsonData?.features)
  } : null;

  /** Formatiert einen Property-Wert für die Anzeige (u.a. Date-Objekte). */
  const formatValue = (value: any): string => {
    if (value instanceof Date) {
      return value.toISOString().split('T')[0];
    }
    if (value === null || value === undefined || value === '') {
      return 'N/A';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value);
  };

  const onEachFeature = (feature: any, layer: L.Layer) => {
    layer.on('click', () => {
      setSelectedFeature(feature);
    });
  };

  const detailPanel: SidebarPanelContent | null = selectedFeature ? {
    title: selectedFeature.properties?.['location_name'] || 'Details',
    onClose: () => setSelectedFeature(null),
    body: Object.entries(selectedFeature.properties).map(([key, value]) => (
      <div key={key} className="map-sidebar__row">
        <span className="map-sidebar__label">{key.replace(/_/g, ' ')}</span>
        <span className="map-sidebar__value">{formatValue(value)}</span>
      </div>
    )),
  } : null;
  const panel = editorPanel ?? detailPanel;

  return (
    <div style={mapWrapperStyle}>
      <MapContainer
        center={[20, 30]}
        zoom={2}
        style={mapContainerStyle}
        zoomControl={false}
      >
        <ZoomControl position="topleft" />
        <FullscreenControl />
        <MapResizeObserver />
        <DrawManager enabled={drawingEnabled} sessionKey={drawingSessionKey} initial={drawingInitial} handlers={drawHandlers} />

        <LayersControl position="topleft">
          <LayersControl.BaseLayer name="GoogleStreets">
            <TileLayer
              url="https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}"
              subdomains={["mt0", "mt1", "mt2", "mt3"]}
              maxZoom={20}
              attribution="Map data © GoogleMaps contributors"
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer checked name="GoogleHybrid">
            <TileLayer
              url="https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}"
              subdomains={["mt0", "mt1", "mt2", "mt3"]}
              maxZoom={20}
              attribution="Map data © GoogleMaps contributors"
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="GoogleEarth">
            <TileLayer
              url="https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}"
              subdomains={["mt0", "mt1", "mt2", "mt3"]}
              maxZoom={20}
              attribution="Map data © GoogleMaps contributors"
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="GoogleTerrain">
            <TileLayer
              url="https://{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}"
              subdomains={["mt0", "mt1", "mt2", "mt3"]}
              maxZoom={20}
              attribution="Map data © GoogleMaps contributors"
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="OpenStreetMap">
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution="© OpenStreetMap contributors"
            />
          </LayersControl.BaseLayer>
        </LayersControl>

        {validGeoJsonData && (
          <GeoJSON data={validGeoJsonData} onEachFeature={onEachFeature} />
        )}

        <FullscreenSidebar panel={panel} />
      </MapContainer>

      {/* Sidebar – erscheint rechts neben der Karte beim Klick auf ein Feature */}
      <div className={`map-sidebar${panel ? ' map-sidebar--open' : ''}`}>
        {panel && <SidebarPanelBody panel={panel} />}
      </div>
    </div>
  );
};

export default MapComponent;

const mapWrapperStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "stretch",
  width: "100%",
  margin: "20px 0",
};

const mapContainerStyle: React.CSSProperties = {
  position: "relative",
  flex: "1 1 auto",
  minWidth: 0,
  aspectRatio: "16 / 13.5",
};