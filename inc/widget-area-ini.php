<?php 
/**
 * Register widget area.
 *
 * @link https://developer.wordpress.org/themes/functionality/sidebars/#registering-a-sidebar
 */
function restly_widgets_init() {
	register_sidebar(
		array(
			'name'          => esc_html__( 'Sidebar', 'restly' ),
			'id'            => 'sidebar',
			'description'   => esc_html__( 'Add widgets here.', 'restly' ),
			'before_widget' => '<section id="%1$s" class="widget %2$s">',
			'after_widget'  => '</section>',
			'before_title'  => '<h2 class="widget-title">',
			'after_title'   => '</h2>',
		),
	);
	register_sidebar(
		array(
			'name'          => esc_html__( 'Footer One', 'restly' ),
			'id'            => 'footer-1',
			'description'   => esc_html__( 'Add widgets here.', 'restly' ),
			'before_widget' => '<section id="%1$s" class="widget footer-widtet %2$s">',
			'after_widget'  => '</section>',
			'before_title'  => '<h4 class="widget-title">',
			'after_title'   => '</h4>',
		),
	);
	register_sidebar(
		array(
			'name'          => esc_html__( 'Footer Two', 'restly' ),
			'id'            => 'footer-2',
			'description'   => esc_html__( 'Add widgets here.', 'restly' ),
			'before_widget' => '<section id="%1$s" class="widget footer-widtet %2$s">',
			'after_widget'  => '</section>',
			'before_title'  => '<h4 class="widget-title">',
			'after_title'   => '</h4>',
		),
	);
	register_sidebar(
		array(
			'name'          => esc_html__( 'Footer Three', 'restly' ),
			'id'            => 'footer-3',
			'description'   => esc_html__( 'Add widgets here.', 'restly' ),
			'before_widget' => '<section id="%1$s" class="widget footer-widtet %2$s">',
			'after_widget'  => '</section>',
			'before_title'  => '<h4 class="widget-title">',
			'after_title'   => '</h4>',
		),
	);
	register_sidebar(
		array(
			'name'          => esc_html__( 'Footer Four', 'restly' ),
			'id'            => 'footer-4',
			'description'   => esc_html__( 'Add widgets here.', 'restly' ),
			'before_widget' => '<section id="%1$s" class="widget footer-widtet %2$s">',
			'after_widget'  => '</section>',
			'before_title'  => '<h4 class="widget-title">',
			'after_title'   => '</h4>',
		)
	);

}
add_action( 'widgets_init', 'restly_widgets_init' );
?>