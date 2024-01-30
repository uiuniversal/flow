import { NgForOf } from '@angular/common';
import {
  Component,
  AfterContentInit,
  AfterViewInit,
  OnDestroy,
  ContentChildren,
  QueryList,
  ViewChild,
  ElementRef,
  NgZone,
  ChangeDetectionStrategy,
} from '@angular/core';
import { startWith } from 'rxjs';
import { Arrangements2 as Arrangements } from './arrangements';
import { Connections } from './connections';
import { FlowChildComponent } from './flow-child.component';
import { FlowService } from './flow.service';
import {
  FlowOptions,
  ChildInfo,
  FlowDirection,
  DotOptions,
  ArrowPathFn,
} from './flow-interface';
import { blendCorners, flowPath, bezierPath, blendCorners1 } from './svg';
import { FitToWindow } from './fit-to-window';

const BASE_SCALE_AMOUNT = 0.05;

@Component({
  standalone: true,
  imports: [NgForOf, FlowChildComponent],
  providers: [FlowService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'ngu-flow',
  template: ` <div class="zoom-container" #zoomContainer>
    <svg #svg>
      <defs>
        <marker
          id="arrowhead"
          markerWidth="10"
          markerHeight="7"
          refX="0"
          refY="3.5"
          orient="auto"
        >
          <polygon points="0 0, 10 3.5, 0 7"></polygon>
        </marker>
      </defs>
      <g #g></g>
      <!-- <g #guideLines></g> -->

      <!-- <text font-size="20" text-anchor="middle">
        <textPath xlink:href="#arrow2-to-1" startOffset="50%">
          Follow me
        </textPath>
      </text> -->
      <!-- <text font-size="20" dy="20" dx="10">
        <textPath
          xlink:href="#arrow2-to-1"
          startOffset="50%"
          side="left"
          text-anchor="middle"
        >
          Follow me
        </textPath>
        <textPath
          xlink:href="#arrow6-to-1"
          startOffset="50%"
          side="left"
          text-anchor="middle"
        >
          Follow me
        </textPath>
      </text> -->
    </svg>
    <ng-content></ng-content>
  </div>`,
  styles: [
    `
      :host {
        --dot-size: 10px;
        --flow-dot-color: red;
        --flow-path-color: blue;
        --grid-size: 20px;
        display: block;
        height: 100%;
        width: 100%;
        position: relative;
        overflow: hidden;
      }

      .flow-pattern {
        position: absolute;
        width: 100%;
        height: 100%;
        top: 0px;
        left: 0px;
      }

      .zoom-container {
        position: absolute;
        top: 0;
        left: 0;
        height: 100%;
        width: 100%;
        transform-origin: 0 0;
      }

      svg {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        overflow: visible;
      }

      #arrowhead polygon {
        fill: var(--flow-path-color);
      }
    `,
  ],
})
export class FlowComponent
  implements AfterContentInit, AfterViewInit, OnDestroy
{
  @ContentChildren(FlowChildComponent) children: QueryList<FlowChildComponent> =
    new QueryList();

  // @ViewChildren('arrowPaths') arrowPaths: QueryList<ElementRef<SVGPathElement>>;
  @ViewChild('zoomContainer') zoomContainer: ElementRef<HTMLDivElement>;
  @ViewChild('svg') svg: ElementRef<SVGSVGElement>;
  @ViewChild('g') g: ElementRef<SVGGElement>;
  // New SVG element for guide lines
  @ViewChild('guideLines') guideLines: ElementRef<SVGGElement>;
  initialX = 0;
  initialY = 0;

  constructor(
    public el: ElementRef<HTMLElement>,
    public flow: FlowService,
    private ngZone: NgZone
  ) {
    this.flow.zoomContainer = this.el.nativeElement;
    this.flow.arrowsChange.subscribe((e) => this.updateArrows(e));
    this.ngZone.runOutsideAngular(() => {
      this.el.nativeElement.addEventListener('wheel', this._wheelPanning);

      this.el.nativeElement.addEventListener(
        'mousedown',
        this._startDraggingZoomContainer
      );
      this.el.nativeElement.addEventListener(
        'mouseup',
        this._stopDraggingZoomContainer
      );
      this.el.nativeElement.addEventListener(
        'mousemove',
        this._dragZoomContainer
      );
    });
  }

  ngAfterViewInit(): void {
    this.createArrows();
  }

  ngAfterContentInit() {
    this.children.changes
      .pipe(startWith(this.children))
      .subscribe((children) => {
        this.flow.update(this.children.map((x) => x.position));
        this.arrangeChildren();
        this.createArrows();
      });
    requestAnimationFrame(() => this.updateArrows()); // this required for angular to render the dot
  }

  updateChildDragging(enable = true) {
    this.flow.enableChildDragging.next(enable);
  }

  updateZooming(enable = true) {
    this.flow.enableZooming.next(enable);
  }

  updateDirection(direction: FlowDirection) {
    this.flow.direction = direction;
    this.arrangeChildren();
    this.createArrows();
  }

  updateArrowFn(fn: ArrowPathFn) {
    this.flow.arrowFn = fn;
    this.createArrows();
  }

  public _startDraggingZoomContainer = (event: MouseEvent) => {
    event.stopPropagation();
    this.flow.isDraggingZoomContainer = true;
    this.initialX = event.clientX - this.flow.panX;
    this.initialY = event.clientY - this.flow.panY;
  };

  public _stopDraggingZoomContainer = (event: MouseEvent) => {
    event.stopPropagation();
    this.flow.isDraggingZoomContainer = false;
  };

  public _dragZoomContainer = (event: MouseEvent) => {
    if (this.flow.isDraggingZoomContainer) {
      event.preventDefault();
      event.stopPropagation();
      this.flow.panX = event.clientX - this.initialX;
      this.flow.panY = event.clientY - this.initialY;
      this.updateZoomContainer();
    }
  };

  public _wheelPanning = (event: WheelEvent) => {
    event.stopPropagation();
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      if (!this.flow.enableZooming.value) return;
      this.zoomHandle(event);
    } else {
      this.flow.panX -= event.deltaX;
      this.flow.panY -= event.deltaY;
      this.updateZoomContainer();
    }
  };

  public zoomHandle = (event: WheelEvent) => {
    if (this.flow.isDraggingZoomContainer || this.flow.isChildDragging) return;
    event.stopPropagation();
    event.preventDefault();
    const scaleDirection = event.deltaY < 0 ? 1 : -1;
    // if it is zoom out and the scale is less than 0.2, then return
    if (scaleDirection === -1 && this.flow.scale < 0.1) return;

    this.setZoom1(event.clientX, event.clientY, scaleDirection);
  };

  private setZoom1(clientX: number, clientY: number, scaleDirection: number) {
    const { left, top } = this.flow.zRect;
    const { scale, panX, panY } = this._setZoom(
      clientX - left,
      clientY - top,
      scaleDirection,
      this.flow.panX,
      this.flow.panY,
      this.flow.scale
    );
    this.flow.scale = scale;
    this.flow.panX = panX;
    this.flow.panY = panY;

    // Apply the zoom and the pan
    this.updateZoomContainer();
  }

  public _setZoom(
    wheelClientX: number,
    wheelClientY: number,
    scaleDirection: number,
    panX: number,
    panY: number,
    scale: number
  ) {
    // Make scaleAmount proportional to the current scale
    const scaleAmount = BASE_SCALE_AMOUNT * scale;
    // Calculate new scale
    const newScale = scale + scaleDirection * scaleAmount;
    // Calculate new pan values to keep the zoom point in the same position on the screen
    const newPanX = wheelClientX + ((panX - wheelClientX) * newScale) / scale;
    const newPanY = wheelClientY + ((panY - wheelClientY) * newScale) / scale;

    return { scale: newScale, panX: newPanX, panY: newPanY };
  }

  fitToWindow() {
    const ftw = new FitToWindow(
      this.list,
      this.zoomContainer.nativeElement.getBoundingClientRect(),
      this.flow.scale,
      this.flow.panX,
      this.flow.panY
    );
    const { scale, panX, panY } = ftw.fitToWindow();
    this.flow.scale = scale;
    this.flow.panX = panX;
    this.flow.panY = panY;
    this.updateZoomContainer();
  }

  private updateZoomContainer() {
    this.zoomContainer.nativeElement.style.transform = `translate3d(${this.flow.panX}px, ${this.flow.panY}px, 0) scale(${this.flow.scale})`;
  }

  arrangeChildren() {
    const arrangements = new Arrangements(
      this.list,
      this.flow.direction,
      this.flow.horizontalPadding,
      this.flow.verticalPadding,
      this.flow.groupPadding
    );
    const newList = arrangements.autoArrange();
    this.flow.update([...newList.values()]);
    this.flow.layoutUpdated.next();
  }

  get list() {
    return this.children.toArray().map((x) => {
      // calculate the width and height with scale
      const elRect = x.el.nativeElement.getBoundingClientRect();
      const width = elRect.width / this.flow.scale;
      const height = elRect.height / this.flow.scale;
      const newElRect = {
        x: elRect.x,
        y: elRect.y,
        bottom: elRect.bottom,
        left: elRect.left,
        right: elRect.right,
        top: elRect.top,
        width,
        height,
      };
      return {
        position: x.position,
        elRect: newElRect,
        dots: x.dots.map((y) => y.nativeElement.getBoundingClientRect()),
      } as ChildInfo;
    });
  }

  createArrows() {
    if (!this.g) {
      return;
    }
    // Clear existing arrows
    this.flow.arrows = [];
    const gElement: SVGGElement = this.g.nativeElement;
    // Remove existing paths
    while (gElement.firstChild) {
      gElement.removeChild(gElement.firstChild);
    }
    // Calculate new arrows
    this.list.forEach((item) => {
      item.position.deps.forEach((depId) => {
        const dep = this.list.find((dep) => dep.position.id === depId);
        if (dep) {
          const arrow = {
            d: `M${item.position.x},${item.position.y} L${dep.position.x},${dep.position.y}`,
            deps: [item.position.id, dep.position.id],
            startDot: 0,
            endDot: 0,
            id: `arrow${item.position.id}-to-${dep.position.id}`,
          };

          // Create path element and set attributes
          const pathElement = document.createElementNS(
            'http://www.w3.org/2000/svg',
            'path'
          );
          pathElement.setAttribute('d', arrow.d);
          pathElement.setAttribute('id', arrow.id);
          pathElement.setAttribute('stroke', 'var(--flow-path-color)');
          pathElement.setAttribute('stroke-width', '2');
          pathElement.setAttribute('fill', 'none');
          pathElement.setAttribute('marker-end', 'url(#arrowhead)');

          // Append path to <g> element
          gElement.appendChild(pathElement);

          this.flow.arrows.push(arrow);
        }
      });
    });
    this.updateArrows();
  }

  positionChange(position: FlowOptions) {
    // Find the item in the list
    const item = this.list.find((item) => item.position.id === position.id);

    // Update item position
    if (!item) return;
    item.position.x = position.x;
    item.position.y = position.y;

    // Update arrows
    this.updateArrows();
  }

  updateArrows(e?: FlowOptions) {
    const gElement: SVGGElement = this.g.nativeElement;
    const childObj = this.getChildInfo();
    // Handle reverse dependencies
    this.flow.connections = new Connections(this.list, this.flow.direction);

    // Calculate new arrows
    this.flow.arrows.forEach((arrow) => {
      const [from, to] = arrow.deps;
      const fromItem = childObj[from];
      const toItem = childObj[to];
      if (fromItem && toItem) {
        const [endDotIndex, startDotIndex] = this.getClosestDots(toItem, from);

        const startDot = this.getDotByIndex(
          childObj,
          fromItem.position,
          startDotIndex,
          this.flow.scale,
          this.flow.panX,
          this.flow.panY
        );
        const endDot = this.getDotByIndex(
          childObj,
          toItem.position,
          endDotIndex,
          this.flow.scale,
          this.flow.panX,
          this.flow.panY
        );

        // we need to reverse the path because the arrow head is at the end
        arrow.d = this.flow.arrowFn(
          endDot,
          startDot,
          this.flow.config.ArrowSize,
          2
        );
      }

      // Update the SVG paths
      this.flow.arrows.forEach((arrow) => {
        const pathElement = gElement.querySelector(
          `#${arrow.id}`
        ) as SVGPathElement;
        if (pathElement) {
          pathElement.setAttribute('d', arrow.d);
        }
      });
    });

    this.flow.connections.updateDotVisibility(this.oldChildObj());
  }

  private oldChildObj() {
    return this.children.toArray().reduce((acc, curr) => {
      acc[curr.position.id] = curr;
      return acc;
    }, {} as Record<string, FlowChildComponent>);
  }

  private getChildInfo() {
    return this.list.reduce((acc, curr) => {
      acc[curr.position.id] = curr;
      return acc;
    }, {} as Record<string, ChildInfo>);
  }

  private getDotByIndex(
    childObj: Record<string, ChildInfo>,
    item: FlowOptions,
    dotIndex: number,
    scale: number,
    panX: number,
    panY: number
  ): DotOptions {
    const child = childObj[item.id];
    const childDots = child.dots as DOMRect[];
    // Make sure the dot index is within bounds
    if (dotIndex < 0 || dotIndex >= childDots.length) {
      throw new Error(`Invalid dot index: ${dotIndex}`);
    }

    const rect = childDots[dotIndex];
    const { left, top } = this.flow.zRect;
    // const rect = dotEl.nativeElement.getBoundingClientRect();
    const x = (rect.x + rect.width / 2 - panX - left) / scale;
    const y = (rect.y + rect.height / 2 - panY - top) / scale;

    return { ...item, x, y, dotIndex };
  }

  public getClosestDots(item: ChildInfo, dep?: string): number[] {
    return this.flow.connections.getClosestDotsSimplified(item, dep as string);
  }

  ngOnDestroy(): void {
    this.el.nativeElement.removeEventListener('wheel', this.zoomHandle);
  }
}
